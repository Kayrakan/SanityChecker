import { Worker } from "bullmq";
import { bullConnection } from "../app/services/queue-bull.server";
import { runScenarioById } from "../app/services/runner.server";
import { markStuckRunsAsError } from "../app/models/run.server";
import prisma from "../app/db.server";
import IORedis from "ioredis";
import { createServer } from "node:http";

// Simple per-shop lock to serialize runs per shop, avoiding API contention.
const redis = new IORedis((bullConnection as any).url || (bullConnection as any));
const LOCK_PREFIX = "run:lock:";
const LOCK_TTL_MS = Number(process.env.SHOP_LOCK_TTL_MS || 600_000); // default 10 minutes



async function acquireShopLock(shopId: string) {
  const key = LOCK_PREFIX + shopId;
  const ok = await redis.set(key, "1", "PX", LOCK_TTL_MS, "NX");
  return ok === "OK";
}
async function releaseShopLock(shopId: string) {
  const key = LOCK_PREFIX + shopId;
  try { await redis.del(key); } catch {}
}

const concurrency = Number(process.env.WORKER_CONCURRENCY || 10);

// BullMQ v5+ does not require an explicit QueueScheduler; delayed/retry jobs are handled internally.

const worker = new Worker(
  "jobs",
  async (job) => {
    console.log("Processing job", job.name, job.id, JSON.stringify(job.data));
    if (job.name === "SCENARIO_RUN") {
      const { shopId, scenarioId, runId } = job.data as { shopId: string; scenarioId: string; runId?: string };
      // Serialize per shop; actively wait for the lock to minimize long backoff delays
      const startWait = Date.now();
      let got = false;
      while (!(got = await acquireShopLock(shopId))) {
        if (Date.now() - startWait > LOCK_TTL_MS) {
          throw new Error("SHOP_LOCK_TIMEOUT");
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      try {
        console.log("Running scenario", scenarioId, "runId", runId || "(new)");
        const result = await runScenarioById(scenarioId, runId);
        console.log("Run complete", result?.id, result?.status);
        return true;
      } finally {
        await releaseShopLock(shopId);
      }
    }
    if (job.name === "DIGEST_EMAIL") {
      const { shopId } = job.data as { shopId: string };
      const shop = await prisma.shop.findUnique({ where: { id: shopId }, include: { settings: true } });
      if (!shop) return true;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const runs = await prisma.run.findMany({ where: { shopId: shop.id, createdAt: { gte: since } }, include: { scenario: true } });
      const { formatDigestText, sendEmailViaResend, sendSlack } = await import("../app/services/notifications.server");
      const text = await formatDigestText(shop.domain, runs);
      if (shop.settings?.slackWebhookUrl) await sendSlack(shop.settings.slackWebhookUrl, text);
      if (shop.settings?.notificationEmail) await sendEmailViaResend({ to: shop.settings.notificationEmail, subject: `Digest: ${shop.domain}`, text });
      return true;
    }
    return true;
  },
  {
    connection: bullConnection as any,
    concurrency,
  }
);

worker.on("ready", () => {
  console.log("BullMQ worker ready (queue: jobs, concurrency:", concurrency, ")");
});
worker.on("failed", (job, err) => {
  console.error("Job failed", job?.name, job?.id, err?.message, err?.stack);
  // If a scenario run ultimately exhausts retries, mark its Run as ERROR instead of leaving it PENDING
  (async () => {
    try {
      if (!job || job.name !== "SCENARIO_RUN") return;
      const isFinal = (job.attemptsMade || 0) >= ((job.opts?.attempts as number | undefined) || 1);
      if (!isFinal) return; // will retry again
      const runId = (job.data as any)?.runId as string | undefined;
      if (!runId) return;
      const existing = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
      if (!existing || existing.status !== "PENDING") return; // already updated by runner
      const isLock = String(err?.message || "").includes("SHOP_LOCKED");
      const diagnostics = [
        { code: isLock ? "SHOP_LOCK_TIMEOUT" : "JOB_FINAL_FAILURE", message: String(err?.message || "Job failed after retries") },
      ];
      await prisma.run.update({ where: { id: runId }, data: { status: "ERROR" as any, diagnostics } });
    } catch (e) {
      console.error("Failed to mark run as ERROR after final job failure", (e as any)?.message || e);
    }
  })();
});
worker.on("completed", (job) => {
  console.log("Job completed", job.name, job.id);
  (async () => {
    try {
      if (job.name === "SCENARIO_RUN") {
        const shopId = (job.data as any)?.shopId as string | undefined;
        if (shopId) {
          // Opportunistically clean up any long-lived pending runs for this shop
          await markStuckRunsAsError(shopId, 30 * 60 * 1000).catch(() => 0);
        }
      }
    } catch {}
  })();
});

// Lightweight HTTP server satisfies Cloud Run health checks.
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
}).listen(Number(process.env.PORT || "8080"));

// Keep process alive
process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
