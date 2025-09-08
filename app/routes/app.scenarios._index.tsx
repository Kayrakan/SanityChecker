import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, Link as RemixLink, Form } from "@remix-run/react";
import { Page, Card, Button, IndexTable, Text, BlockStack, InlineStack, Badge, Banner } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRunBull } from "../services/queue-bull.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("loader running");
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { scenarios: true } });
  return json({ scenarios: shop?.scenarios ?? [], shopId: shop?.id ?? null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "create") {
    const db: any = prisma;
    const shop = await db.shop.upsert({
      where: { domain: session.shop },
      create: { domain: session.shop, settings: { create: {} } },
      update: {},
    });
    const scenario = await db.scenario.create({
      data: {
        shopId: shop.id,
        name: String(form.get("name") || "New scenario"),
        countryCode: String(form.get("countryCode") || "US"),
        postalCode: String(form.get("postalCode") || "94107"),
        productVariantIds: [],
        quantities: [],
      },
    });
    return redirect(`/app/scenarios/${scenario.id}?new=1`);
  }
  if (intent === "run") {
    const scenarioId = String(form.get("scenarioId"));
    const db: any = prisma;
    const shop = await db.shop.upsert({
      where: { domain: session.shop },
      create: { domain: session.shop, settings: { create: {} } },
      update: {},
    });
    const run = await enqueueScenarioRunBull(shop.id, scenarioId);
    return json({ ok: true, runId: run.id });
  }
  return json({ ok: true });
};

export default function ScenariosIndex() {
  const { scenarios } = useLoaderData<typeof loader>();
  const app = useAppBridge();
  const [enqueued, setEnqueued] = useState<{ runId?: string } | null>(null);
  useEffect(() => {
    if (enqueued) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    }
  }, [enqueued]);

  return (
    <Page title="Scenarios">
      <BlockStack gap="400">
        {enqueued ? (
          <Banner
            title="Scenario run enqueued"
            tone="success"
            onDismiss={() => setEnqueued(null)}
            action={enqueued.runId ? { content: 'View run', url: `/app/runs/${enqueued.runId}` } : { content: 'Open Runs', url: '/app/runs' }}
            secondaryAction={{ content: 'Open Runs', url: '/app/runs' }}
          >
            <p>You can monitor progress on the Runs page.</p>
          </Banner>
        ) : null}
        <InlineStack>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <Button submit variant="primary">New scenario</Button>
          </Form>
        </InlineStack>
        <Card>
          <IndexTable
            resourceName={{ singular: 'scenario', plural: 'scenarios' }}
            itemCount={scenarios.length}
            headings={[{ title: 'Name' }, { title: 'Destination' }, { title: 'Active' }, { title: 'Actions' }]}
            selectable={false}
          >
            {scenarios.map((s: any, idx: number) => (
              <IndexTable.Row id={s.id} key={s.id} position={idx}>
                <IndexTable.Cell>
                  <RemixLink to={`/app/scenarios/${s.id}`}>
                    <Text variant="bodyMd" as="span">{s.name}</Text>
                  </RemixLink>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text variant="bodyMd" as="span">{s.countryCode}{s.postalCode ? ` / ${s.postalCode}` : ''}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={s.active ? 'success' : 'critical'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <RunScenarioButton scenarioId={s.id} onEnqueued={(id?: string) => setEnqueued({ runId: id })} />
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}

function RunScenarioButton({ scenarioId, onEnqueued }: { scenarioId: string; onEnqueued?: (runId?: string) => void }) {
  const fetcher = useFetcher();
  const app = useAppBridge();
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  useEffect(() => {
    const data: any = fetcher.data as any;
    if (fetcher.state === 'idle' && data?.ok) {
      setLastRunId(String(data?.runId || ''));
      if (onEnqueued) onEnqueued(data?.runId);
      app.toast.show('Scenario run enqueued');
    }
  }, [fetcher.state, fetcher.data, app]);
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <InlineStack gap="200">
        <Button submit loading={fetcher.state !== 'idle'}>Run</Button>
        {lastRunId ? (
          <Button url={`/app/runs/${lastRunId}`} variant="plain">View run</Button>
        ) : (
          <Button url="/app/runs" variant="plain">Runs</Button>
        )}
      </InlineStack>
    </fetcher.Form>
  );
}

