import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { seedStarterScenarios } from "../services/auto-starters.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const shop = await db.shop.upsert({ where: { domain: session.shop }, create: { domain: session.shop, settings: { create: {} } }, update: {} });
  await seedStarterScenarios(session.shop, shop.id);
  return null;
};
