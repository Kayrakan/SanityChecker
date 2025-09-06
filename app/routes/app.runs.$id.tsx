import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link as RemixLink, useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Box, Button, BlockStack, InlineStack, Badge, DataTable } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRunBull } from "../services/queue-bull.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const run = await db.run.findUnique({ where: { id: String(params.id) }, include: { scenario: true } });
  if (!run) throw new Response("Not Found", { status: 404 });
  const recent = await db.run.findMany({ where: { scenarioId: run.scenarioId }, orderBy: { createdAt: "desc" }, take: 14 });
  return json({ run, history: recent });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const form = await request.formData();
  const intent = String(form.get("intent") || "rerun");
  const run = await db.run.findUnique({ where: { id: String(params.id) }, include: { scenario: true, shop: true } });
  if (!run) throw new Response("Not Found", { status: 404 });
  if (intent === "rerun") {
    await enqueueScenarioRunBull(run.shopId, run.scenarioId);
    return json({ ok: true });
  }
  if (intent === "ack") {
    await (prisma as any).run.update({ where: { id: run.id }, data: { acknowledgedAt: new Date() } });
    return json({ ok: true, acknowledged: true });
  }
  return json({ ok: true });
};

export default function RunDetail() {
  const { run, history } = useLoaderData<typeof loader>();
  const rerunFetcher = useFetcher();
  const ackFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const options: Array<any> = Array.isArray((run as any)?.result?.options) ? (run as any).result.options : [];
  const subtotal = (run as any)?.result?.subtotal;
  const cheapest = options && options.length ? options.reduce((acc: any, o: any) => Math.min(acc, Number(o?.estimatedCost?.amount || Infinity)), Infinity) : null;
  const rows = (options || []).map((o: any) => [o?.title || "(untitled)", String(o?.estimatedCost?.amount ?? "") + (subtotal?.currencyCode ? ` ${subtotal.currencyCode}` : ""), ""]); // placeholder for delivery window/source

  const expectations: any = (run as any)?.scenario?.expectations || {};
  const boundsTarget = expectations?.boundsTarget || 'CHEAPEST';
  const boundsTitle = expectations?.boundsTitle || '';
  const min = expectations?.min;
  const max = expectations?.max;
  const freeThreshold = expectations?.freeShippingThreshold;
  const targetSummary = boundsTarget === 'TITLE' && boundsTitle ? `title contains: ${boundsTitle}` : 'Cheapest';
  const targetPrice = cheapest != null && cheapest !== Infinity ? cheapest : undefined;

  return (
    <Page title="Run details">
      <BlockStack gap="400">
        <Card>
          <InlineStack align="space-between">
            <InlineStack gap="200">
              <Text as="h3" variant="headingMd">Status</Text>
              <Badge tone={run.status === 'PASS' ? 'success' : run.status === 'WARN' ? 'attention' : run.status === 'FAIL' || run.status === 'ERROR' ? 'critical' : run.status === 'BLOCKED' ? 'warning' : 'new'}>{run.status}</Badge>
              {run.acknowledgedAt ? (<Badge>Acknowledged</Badge>) : null}
            </InlineStack>
            <InlineStack gap="200">
              <rerunFetcher.Form method="post">
                <input type="hidden" name="intent" value="rerun" />
                <Button submit loading={rerunFetcher.state !== 'idle'}>Re-run</Button>
              </rerunFetcher.Form>
              <ackFetcher.Form method="post">
                <input type="hidden" name="intent" value="ack" />
                <Button submit variant="secondary" loading={ackFetcher.state !== 'idle'}>Acknowledge</Button>
              </ackFetcher.Form>
              <deleteFetcher.Form method="post" action={`/api/runs/${run.id}`} onSubmit={(e) => { if (!confirm('Delete this run? This cannot be undone.')) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="delete" />
                <Button submit tone="critical" variant="secondary" loading={deleteFetcher.state !== 'idle'}>Delete</Button>
              </deleteFetcher.Form>
            </InlineStack>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="p" variant="bodyMd">
              Started: {new Date(run.startedAt).toLocaleString()} {run.finishedAt ? `• Finished: ${new Date(run.finishedAt).toLocaleString()}` : ''}
            </Text>
            <Text as="p" variant="bodyMd">
              Duration: {run.finishedAt ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) + ' ms' : '—'}
            </Text>
          </InlineStack>
          <Text as="p" variant="bodyMd">
            Scenario: <RemixLink to={`/app/scenarios/${run.scenarioId}`}>{run.scenario?.name ?? 'Scenario'}</RemixLink>
          </Text>
        </Card>

        <Card>
          <Text as="h3" variant="headingMd">Cart & destination</Text>
          <Text as="p" variant="bodyMd">{run.scenario?.countryCode}{run.scenario?.postalCode ? ` • ${run.scenario.postalCode}` : ''}{run.scenario?.city ? ` • ${run.scenario.city}` : ''}</Text>
        </Card>

        <Card>
          <Text as="h3" variant="headingMd">Expected vs observed</Text>
          <BlockStack gap="150">
            <InlineStack gap="200">
              <Badge>{`Target: ${targetSummary}`}</Badge>
              {typeof min === 'number' || typeof max === 'number' ? (<Badge>{`Band: ${min ?? '–'} – ${max ?? '–'}`}</Badge>) : null}
              {typeof freeThreshold === 'number' ? (<Badge>{`Free ≥ ${freeThreshold}`}</Badge>) : null}
              {targetPrice != null ? (<Badge tone="success">{`Observed target: ${targetPrice}${subtotal?.currencyCode ? ` ${subtotal.currencyCode}` : ''}`}</Badge>) : null}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <Text as="h3" variant="headingMd">Rates</Text>
          <DataTable
            columnContentTypes={["text","text","text"]}
            headings={["Title","Price","Notes"]}
            rows={rows}
          />
        </Card>

        {run?.screenshotUrl ? (
          <Card>
            <Text as="h3" variant="headingMd">Screenshot</Text>
            <Box padding="400" background="bg-surface-active" borderWidth="025" borderRadius="200" borderColor="border">
              <img src={String(run.screenshotUrl)} alt="Checkout screenshot" style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
            </Box>
          </Card>
        ) : null}

        <Card>
          <Text as="h3" variant="headingMd">Why this was flagged</Text>
          <BlockStack gap="150">
            {Array.isArray(run?.diagnostics) && (run.diagnostics as any[]).length > 0 ? (
              (run.diagnostics as any[]).map((d: any, idx: number) => (
                <Text key={idx} as="p" variant="bodyMd">• {d?.message || d?.code || JSON.stringify(d)}</Text>
              ))
            ) : (
              <Text as="p" variant="bodyMd">No issues detected.</Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <Text as="h3" variant="headingMd">History (last 14)</Text>
          <Box padding="400" background="bg-surface-active" borderWidth="025" borderRadius="200" borderColor="border" overflowX="scroll">
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify(history, null, 2)}</code>
            </pre>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}

