import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link as RemixLink, useRevalidator, Form, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo } from "react";
import { Page, Card, IndexTable, Text, Badge, Button, Select, InlineStack, BlockStack, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "").toUpperCase();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const scenarioId = url.searchParams.get("scenarioId");

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  let runs: any[] = [];
  let scenarios: any[] = [];
  let summary = { pass: 0, warn: 0, fail: 0 };
  if (shop) {
    const where: any = { shopId: shop.id };
    if (status && ["PENDING","PASS","WARN","FAIL","ERROR","BLOCKED"].includes(status)) {
      where.status = status as any;
    }
    if (scenarioId) where.scenarioId = scenarioId;
    if (from || to) {
      const createdAt: any = {};
      if (from) createdAt.gte = new Date(from);
      if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
      where.createdAt = createdAt;
    }
    // Default date window to last 24h when not provided
    if (!from && !to) {
      where.createdAt = { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }
    runs = await prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { scenario: true },
    });
    scenarios = await prisma.scenario.findMany({ where: { shopId: shop.id }, orderBy: { name: "asc" } });
    // Summary in last 24h regardless of filters (quick triage)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [passCount, warnCount, failErrCount] = await Promise.all([
      prisma.run.count({ where: { shopId: shop.id, createdAt: { gte: since }, status: "PASS" } }),
      prisma.run.count({ where: { shopId: shop.id, createdAt: { gte: since }, status: "WARN" } }),
      prisma.run.count({ where: { shopId: shop.id, createdAt: { gte: since }, status: { in: ["FAIL", "ERROR"] } } as any }),
    ]);
    summary = { pass: passCount, warn: warnCount, fail: failErrCount };
  }
  return json({ runs, filters: { status, from, to, scenarioId }, scenarios, summary });
};

export default function RunsIndex() {
  const { runs, filters, scenarios, summary } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        revalidator.revalidate();
      }
    }, 10000);
    return () => clearInterval(id);
  }, [revalidator]);
  const csvUrl = useMemo(() => {
    const q = new URLSearchParams(searchParams);
    q.set('limit', '500');
    q.set('format', 'csv');
    return `/api/runs?${q.toString()}`;
  }, [searchParams]);
  const deleteAllAction = useMemo(() => {
    const q = new URLSearchParams(searchParams);
    return `/api/runs?${q.toString()}`;
  }, [searchParams]);
  return (
    <Page title="Runs">
      <BlockStack gap="400">
        <Card>
          <InlineStack align="space-between">
            <InlineStack gap="200">
              <Badge tone="critical">{`Fail ${summary.fail}`}</Badge>
              <Badge tone="attention">{`Warn ${summary.warn}`}</Badge>
              <Badge tone="success">{`Pass ${summary.pass}`}</Badge>
            </InlineStack>
            <InlineStack gap="200">
              {revalidator.state !== 'idle' && <InlineStack gap="100" blockAlign="center"><Spinner size="small" /><Text as="span" variant="bodySm" tone="subdued">Refreshing…</Text></InlineStack>}
              <Form method="post" action="/app">
                <input type="hidden" name="intent" value="run_all" />
                <Button submit>Run all active</Button>
              </Form>
              <Button url={csvUrl} variant="secondary">Export CSV</Button>
              <Form method="post" action={deleteAllAction} onSubmit={(e) => { if (!confirm('Delete all listed runs? This cannot be undone.')) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="delete_all" />
                <Button submit tone="critical" variant="secondary">Delete all</Button>
              </Form>
            </InlineStack>
          </InlineStack>
        </Card>
        <Card>
          <InlineStack gap="200">
            <Select
              label="Status"
              options={[{label:'All', value:''},{label:'PASS', value:'PASS'},{label:'WARN', value:'WARN'},{label:'FAIL', value:'FAIL'},{label:'ERROR', value:'ERROR'},{label:'PENDING', value:'PENDING'}]}
              value={filters.status || ''}
              onChange={(v) => {
                const sp = new URLSearchParams(searchParams);
                if (v) sp.set('status', v); else sp.delete('status');
                setSearchParams(sp);
              }}
            />
            {/* Date filters can be added here later */}
            <Select
              label="Scenario"
              options={[{ label: 'All', value: '' }, ...scenarios.map((s: any) => ({ label: s.name, value: s.id }))]}
              value={filters.scenarioId || ''}
              onChange={(v) => {
                const sp = new URLSearchParams(searchParams);
                if (v) sp.set('scenarioId', v); else sp.delete('scenarioId');
                setSearchParams(sp);
              }}
            />
          </InlineStack>
        </Card>
        <Card>
          <IndexTable
            resourceName={{ singular: 'run', plural: 'runs' }}
            itemCount={runs.length}
            headings={[{ title: 'Scenario' }, { title: 'Status' }, { title: 'Started' }, { title: 'Duration' }, { title: 'Actions' }]}
            selectable={false}
          >
            {runs.map((r: any, idx: number) => (
              <IndexTable.Row id={r.id} key={r.id} position={idx}>
                <IndexTable.Cell>
                  <RemixLink to={`/app/runs/${r.id}`}>
                    <Text as="span" variant="bodyMd">{r.scenario?.name ?? 'Scenario'}</Text>
                  </RemixLink>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={r.status === 'PASS' ? 'success' : r.status === 'WARN' ? 'attention' : r.status === 'FAIL' || r.status === 'ERROR' ? 'critical' : 'new'}>{r.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{new Date(r.startedAt).toLocaleString()}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{r.finishedAt ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) + ' ms' : '—'}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200">
                    <Form method="post" action={`/app/runs/${r.id}`}>
                      <input type="hidden" name="intent" value="rerun" />
                      <Button submit size="slim">Re-run</Button>
                    </Form>
                    <Form method="post" action={`/api/runs/${r.id}`} onSubmit={(e) => { if (!confirm('Delete this run?')) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="delete" />
                      <Button submit size="slim" tone="critical" variant="secondary">Delete</Button>
                    </Form>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}

