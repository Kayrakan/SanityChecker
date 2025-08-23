import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link as RemixLink, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  Badge,
  ProgressBar,
  Banner,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRun } from "../models/job.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const db: any = prisma;
  const shop = await db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, settings: { create: {} } },
    update: {},
    include: { settings: true },
  });

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalScenarios, activeScenarios, runs7d, lastRuns] = await Promise.all([
    db.scenario.count({ where: { shopId: shop.id } }),
    db.scenario.count({ where: { shopId: shop.id, active: true } }),
    db.run.findMany({ where: { shopId: shop.id, createdAt: { gte: since7d } } }),
    db.run.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { scenario: true },
    }),
  ]);

  const pass = runs7d.filter((r: any) => r.status === "PASS").length;
  const warn = runs7d.filter((r: any) => r.status === "WARN").length;
  const fail = runs7d.filter((r: any) => r.status === "FAIL" || r.status === "ERROR").length;
  const totalRuns = runs7d.length || 1;
  const passRate = Math.round((pass / totalRuns) * 100);

  const schedule = shop.settings?.promoMode
    ? { label: "Hourly (promo mode)", detail: "Runs every hour" }
    : { label: `Daily at ${String(shop.settings?.dailyRunHourUtc ?? 7).padStart(2, "0")}:00 UTC`, detail: "Runs once per day" };

  return json({
    shopId: shop.id,
    metrics: {
      totalScenarios,
      activeScenarios,
      pass7d: pass,
      warn7d: warn,
      fail7d: fail,
      passRate,
    },
    lastRuns,
    hasStorefrontToken: Boolean(shop.settings?.storefrontAccessToken),
    schedule,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const shop = await db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, settings: { create: {} } },
    update: {},
  });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent === "run_all") {
    const scenarios = await db.scenario.findMany({ where: { shopId: shop.id, active: true } });
    for (const s of scenarios) {
      await enqueueScenarioRun(shop.id, s.id);
    }
    return json({ ok: true, enqueued: scenarios.length });
  }
  return json({ ok: true });
};

export default function Index() {
  const fetcher = useFetcher();
  const { metrics, lastRuns, schedule } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  useEffect(() => {
    const data: any = fetcher.data as any;
    if (fetcher.state === "idle" && data?.enqueued != null) {
      shopify.toast.show(`Enqueued ${data.enqueued} scenarios`);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const runAll = () => fetcher.submit({ intent: "run_all" }, { method: "POST" });

  return (
    <Page>
      <TitleBar title="Shipping Sanity Tester" />

      <BlockStack gap="500">
        {/* Storefront token is provisioned automatically when needed */}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Overview</Text>
                <InlineStack gap="400">
                  <Card>
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">Active scenarios</Text>
                      <Text as="p" variant="headingLg">{metrics.activeScenarios} <Text as="span" tone="subdued">/ {metrics.totalScenarios}</Text></Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">Pass rate (7d)</Text>
                      <InlineStack align="space-between">
                        <Text as="p" variant="headingLg">{metrics.passRate}%</Text>
                        <Badge tone={metrics.passRate >= 95 ? 'success' : metrics.passRate >= 80 ? 'attention' : 'critical'}>{`${metrics.pass7d}/${metrics.pass7d + metrics.warn7d + metrics.fail7d}`}</Badge>
                      </InlineStack>
                      <ProgressBar progress={metrics.passRate} size="small" />
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">Schedule</Text>
                      <Text as="p" variant="headingLg">{schedule.label}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{schedule.detail}</Text>
                    </BlockStack>
                  </Card>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recent runs</Text>
                <IndexTable
                  resourceName={{ singular: 'run', plural: 'runs' }}
                  itemCount={lastRuns.length}
                  selectable={false}
                  headings={[{ title: 'Scenario' }, { title: 'Status' }, { title: 'Started' }]}
                >
                  {lastRuns.map((r: any, idx: number) => (
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
                    </IndexTable.Row>
                  ))}
                </IndexTable>
                <InlineStack>
                  <Button url="/app/runs" variant="plain">View all runs</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Quick actions</Text>
                <InlineStack gap="200">
                  <Form method="post" action="/app/scenarios">
                    <input type="hidden" name="intent" value="create" />
                    <Button submit variant="primary">New scenario</Button>
                  </Form>
                  <Button onClick={runAll} loading={fetcher.state !== 'idle'}>Run all now</Button>
                </InlineStack>
                <InlineStack>
                  <Button url="/app/scenarios" variant="plain">Manage scenarios</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
