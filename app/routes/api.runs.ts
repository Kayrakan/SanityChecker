import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function toCsv(rows: any[]) {
  const headers = ["id","scenario","status","country","postal","city","startedAt","finishedAt","durationMs","targetPrice","freePresent"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const duration = r.finishedAt ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : null;
    const options = (r.result?.options || []) as Array<{ title: string; estimatedCost?: { amount: string } }>;
    const cheapest = options && options.length ? options.reduce((acc: any, o: any) => Math.min(acc, Number(o?.estimatedCost?.amount || Infinity)), Infinity) : null;
    const freePresent = options && options.some((o: any) => Number(o?.estimatedCost?.amount || 0) === 0);
    const row = [
      r.id,
      (r.scenario?.name || '').replaceAll(","," "),
      r.status,
      r.scenario?.countryCode || '',
      r.scenario?.postalCode || '',
      r.scenario?.city || '',
      new Date(r.startedAt).toISOString(),
      r.finishedAt ? new Date(r.finishedAt).toISOString() : '',
      duration == null ? '' : String(duration),
      cheapest == null || cheapest === Infinity ? '' : String(cheapest),
      freePresent ? '1' : '0',
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "").toUpperCase();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const scenarioId = url.searchParams.get("scenarioId");
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const format = String(url.searchParams.get("format") || "json").toLowerCase();

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ runs: [] });
  const where: any = { shopId: shop.id };
  if (status && ["PENDING","PASS","WARN","FAIL","ERROR","BLOCKED"].includes(status)) where.status = status as any;
  if (scenarioId) where.scenarioId = scenarioId;
  if (from || to) {
    const createdAt: any = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
    where.createdAt = createdAt;
  } else {
    where.createdAt = { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
  }
  const runs = await prisma.run.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, include: { scenario: true } });
  if (format === 'csv') {
    const text = toCsv(runs);
    return new Response(text, { headers: { 'Content-Type': 'text/csv' } });
  }
  return json({ runs });
};


