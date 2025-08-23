import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { enqueueScenarioRun, enqueueDigestEmail } from "../models/job.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const hour = now.getUTCHours();

  const shops = await prisma.shop.findMany({ include: { settings: true, scenarios: true } });
  for (const shop of shops) {
    const settings = shop.settings;
    if (!settings) continue;
    const shouldRun = settings.promoMode || settings.dailyRunHourUtc === hour;
    if (!shouldRun) continue;
    for (const s of shop.scenarios) {
      if (!s.active) continue;
      await enqueueScenarioRun(shop.id, s.id);
    }
    await enqueueDigestEmail(shop.id);
  }

  return json({ ok: true });
};


