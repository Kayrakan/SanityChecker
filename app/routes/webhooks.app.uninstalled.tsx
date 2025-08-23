import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Cleanup tenant data (best effort)
  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  if (shopRow) {
    await db.job.deleteMany({ where: { shopId: shopRow.id } });
    await db.run.deleteMany({ where: { shopId: shopRow.id } });
    await db.scenario.deleteMany({ where: { shopId: shopRow.id } });
    await db.settings.deleteMany({ where: { shopId: shopRow.id } });
    await db.shop.delete({ where: { id: shopRow.id } });
  }

  return new Response();
};
