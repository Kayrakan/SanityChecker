import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { enqueueScenarioRunBull } from "../services/queue-bull.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const run = await prisma.run.findUnique({ where: { id: String(params.id) }, include: { scenario: true } });
  if (!run) throw new Response("Not Found", { status: 404 });
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop || run.shopId !== shop.id) throw new Response("Forbidden", { status: 403 });
  return json({ run });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const run = await prisma.run.findUnique({ where: { id: String(params.id) } });
  if (!run) throw new Response("Not Found", { status: 404 });
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop || run.shopId !== shop.id) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent === 'rerun') {
    await enqueueScenarioRunBull(run.shopId, run.scenarioId);
    return json({ ok: true });
  }
  if (intent === 'ack') {
    await prisma.run.update({ where: { id: run.id }, data: { acknowledgedAt: new Date() } });
    return json({ ok: true, acknowledged: true });
  }
  if (intent === 'delete') {
    await prisma.run.delete({ where: { id: run.id } });
    return redirect('/app/runs');
  }
  return json({ ok: true });
};


