import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, Link as RemixLink, Form } from "@remix-run/react";
import { Page, Card, Button, IndexTable, Text, BlockStack, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRun } from "../models/job.server";

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
    await enqueueScenarioRun(shop.id, scenarioId);
    return json({ ok: true });
  }
  return json({ ok: true });
};

export default function ScenariosIndex() {
  const { scenarios } = useLoaderData<typeof loader>();

  return (
    <Page title="Scenarios">
      <BlockStack gap="400">
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
                  <RunScenarioButton scenarioId={s.id} />
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}

function RunScenarioButton({ scenarioId }: { scenarioId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <Button submit loading={fetcher.state !== 'idle'}>Run</Button>
    </fetcher.Form>
  );
}


