import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { claimNextJob, finishJob } from "../models/job.server";
import { runScenarioById } from "../services/runner.server";
import { formatDigestText, sendEmailViaResend, sendSlack } from "../services/notifications.server";

async function processJob(job: any) {
  if (job.type === "SCENARIO_RUN") {
    await runScenarioById(job.scenarioId!);
    return true;
  }
  if (job.type === "DIGEST_EMAIL") {
    const shop = await prisma.shop.findUnique({ where: { id: job.shopId! }, include: { settings: true } });
    if (!shop) return true;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const runs = await prisma.run.findMany({ where: { shopId: shop.id, createdAt: { gte: since } }, include: { scenario: true } });
    const text = await formatDigestText(shop.domain, runs);
    if (shop.settings?.slackWebhookUrl) await sendSlack(shop.settings.slackWebhookUrl, text);
    if (shop.settings?.notificationEmail) await sendEmailViaResend({ to: shop.settings.notificationEmail, subject: `Digest: ${shop.domain}`, text });
    return true;
  }
  return true;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let processed = 0;
  while (true) {
    const job = await claimNextJob();
    if (!job) break;
    try {
      const ok = await processJob(job);
      await finishJob(job.id, ok);
    } catch (err: any) {
      await finishJob(job.id, false, err?.message);
    }
    processed++;
    if (processed >= 25) break; // safety cap per drain tick
  }
  return json({ processed });
};


