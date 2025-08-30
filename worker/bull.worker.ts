import { Worker, QueueScheduler } from "bullmq";
import { bullConnection } from "../app/services/queue-bull.server";
import { runScenarioById } from "../app/services/runner.server";
import prisma from "../app/db.server";
import IORedis from "ioredis";

// Simple per-shop lock to serialize runs per shop, avoiding API contention.
const redis = new IORedis((bullConnection as any).url || (bullConnection as any));
const LOCK_PREFIX = "run:lock:";
const LOCK_TTL_MS = Number(process.env.SHOP_LOCK_TTL_MS || 60_000);

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

// Ensure delayed/retry jobs are managed
const scheduler = new QueueScheduler("jobs", { connection: bullConnection as any });

const worker = new Worker(
  "jobs",
  async (job) => {
    if (job.name === "SCENARIO_RUN") {
      const { shopId, scenarioId, runId } = job.data as { shopId: string; scenarioId: string; runId?: string };
      // Serialize per shop
      const got = await acquireShopLock(shopId);
      if (!got) {
        // Let BullMQ retry with backoff
        throw new Error("SHOP_LOCKED");
      }
      try {
        await runScenarioById(scenarioId, runId);
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
  console.error("Job failed", job?.name, job?.id, err?.message);
});
worker.on("completed", (job) => {
  console.log("Job completed", job.name, job.id);
});

// Keep process alive
process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
