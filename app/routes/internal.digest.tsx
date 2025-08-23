import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendSlack, sendEmailViaResend } from "../services/notifications.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shops = await prisma.shop.findMany({ include: { settings: true } });
  for (const shop of shops) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const runs = await prisma.run.findMany({ where: { shopId: shop.id, createdAt: { gte: since } }, include: { scenario: true } });
    const fails = runs.filter(r => r.status === 'FAIL' || r.status === 'ERROR');
    const warns = runs.filter(r => r.status === 'WARN');
    const ok = runs.filter(r => r.status === 'PASS');

    const summary = `Shipping Sanity Digest for ${shop.domain}\nPASS: ${ok.length} WARN: ${warns.length} FAIL: ${fails.length}`;
    const settings = shop.settings;
    if (settings?.slackWebhookUrl) {
      await sendSlack(settings.slackWebhookUrl, summary);
    }
    if (settings?.notificationEmail) {
      await sendEmailViaResend({ to: settings.notificationEmail, subject: `Digest: ${shop.domain}`, text: summary });
    }
  }

  return json({ ok: true });
};


