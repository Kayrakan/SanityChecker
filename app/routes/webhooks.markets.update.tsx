import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRun } from "../models/job.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  const dbShop = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!dbShop) return new Response();
  const scenarios = await prisma.scenario.findMany({ where: { shopId: dbShop.id, active: true } });
  for (const s of scenarios) await enqueueScenarioRun(dbShop.id, s.id);
  return new Response();
};


