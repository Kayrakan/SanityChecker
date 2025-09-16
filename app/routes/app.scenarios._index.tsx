import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, Link as RemixLink, Form } from "@remix-run/react";
import { Page, Card, Button, IndexTable, Text, BlockStack, InlineStack, Badge, Banner } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, BASIC_PLAN, PRO_PLAN, SCALE_PLAN } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRunBull } from "../services/queue-bull.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  if (process.env.NODE_ENV !== "production" && process.env.ENFORCE_BILLING !== "1") {
    const db: any = prisma;
    const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { scenarios: true } });
    const scenarios = shop?.scenarios ?? [];
    const cap = 10;
    const atCap = scenarios.length >= cap;
    return json({ scenarios, shopId: shop?.id ?? null, cap, atCap });
  }
  const url = new URL(request.url);
  await billing.require({
    plans: [BASIC_PLAN, PRO_PLAN, SCALE_PLAN],
    isTest: process.env.NODE_ENV !== "production",
    onFailure: async () => {
      try {
        return await billing.request({
          plan: BASIC_PLAN,
          isTest: process.env.NODE_ENV !== "production",
        });
      } catch (e) {
        console.error("billing.request failed", e);
        throw e;
      }
    },
  });
  const db: any = prisma;
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { scenarios: true } });
  const scenarios = shop?.scenarios ?? [];
  // Determine cap by checking highest plan first
  const scale = await billing.check({ session, plans: [SCALE_PLAN] });
  const pro = scale.hasActivePayment ? { hasActivePayment: false } : await billing.check({ session, plans: [PRO_PLAN] });
  const cap = scale.hasActivePayment ? 60 : pro.hasActivePayment ? 30 : 10;
  const atCap = scenarios.length >= cap;
  return json({ scenarios, shopId: shop?.id ?? null, cap, atCap });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "create") {
    const db: any = prisma;
    const shop = await db.shop.upsert({
      where: { domain: session.shop },
      create: { domain: session.shop, settings: { create: {} } },
      update: {},
    });
    // Enforce plan caps: Basic 10, Pro 30, Scale 60
    const count = await db.scenario.count({ where: { shopId: shop.id } });
    // Simplest: query active subscription via check and infer caps
    const hasBasic = await billing.check({ session, plans: [BASIC_PLAN] });
    const hasPro = await billing.check({ session, plans: [PRO_PLAN] });
    const hasScale = await billing.check({ session, plans: [SCALE_PLAN] });
    const cap = hasScale.hasActivePayment ? 60 : hasPro.hasActivePayment ? 30 : 10;
    if (count >= cap) {
      const url = new URL("/app/billing", request.url);
      url.searchParams.set("reason", "cap");
      url.searchParams.set("cap", String(cap));
      return Response.redirect(url.toString(), 302);
    }
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
  const { scenarios, cap, atCap } = useLoaderData<typeof loader>();
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
        {atCap ? (
          <Banner
            title="Scenario limit reached"
            tone="warning"
            action={{ content: 'Upgrade plan', url: '/app/billing?reason=cap' }}
          >
            <p>You’ve reached your plan’s limit of {cap} scenarios. Upgrade to create more.</p>
          </Banner>
        ) : null}
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
            <Button submit variant="primary" disabled={atCap} aria-disabled={atCap}>
              {atCap ? 'Upgrade to add more' : 'New scenario'}
            </Button>
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

function UpgradeGate() {
  const [capReached, setCapReached] = useState<boolean>(false);
  const [cap, setCap] = useState<number>(10);
  useEffect(() => {
    // This gate is toggled by the action response when creating beyond cap
    const sub = (e: any) => {
      if (e?.detail?.type === 'CAP_REACHED') {
        setCapReached(true);
        setCap(Number(e.detail.cap) || 10);
      }
    };
    window.addEventListener('app:cap', sub as any);
    return () => { window.removeEventListener('app:cap', sub as any); };
  }, []);
  if (!capReached) return null;
  return (
    <Banner
      title="Scenario limit reached"
      tone="warning"
      action={{ content: 'Upgrade plan', url: '/app/billing' }}
      onDismiss={() => setCapReached(false)}
    >
      <p>You’ve reached your plan’s limit of {cap} scenarios. Upgrade to create more.</p>
    </Banner>
  );
}

