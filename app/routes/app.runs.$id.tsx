import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Box, Button, BlockStack, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueScenarioRun } from "../models/job.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const run = await db.run.findUnique({ where: { id: String(params.id) }, include: { scenario: true } });
  if (!run) throw new Response("Not Found", { status: 404 });
  return json({ run });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db: any = prisma;
  const run = await db.run.findUnique({ where: { id: String(params.id) }, include: { scenario: true, shop: true } });
  if (!run) throw new Response("Not Found", { status: 404 });
  await enqueueScenarioRun(run.shopId, run.scenarioId);
  return json({ ok: true });
};

export default function RunDetail() {
  const { run } = useLoaderData<typeof loader>();
  return (
    <Page title="Run details">
      <BlockStack gap="400">
        <Card>
          <Text as="h3" variant="headingMd">Timeline</Text>
          <Box padding="400" background="bg-surface-active" borderWidth="025" borderRadius="200" borderColor="border" overflowX="scroll">
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify([
                "cartCreate",
                "buyerIdentityUpdate",
                ...(run?.result?.subtotal ? ["discountCodesUpdate (optional)"] : []),
                "deliveryOptionsQuery",
                "diagnostics",
              ], null, 2)}</code>
            </pre>
          </Box>
        </Card>
        <Card>
          <InlineStack align="space-between">
            <Text as="h3" variant="headingMd">Status</Text>
            <Badge tone={run.status === 'PASS' ? 'success' : run.status === 'WARN' ? 'attention' : run.status === 'FAIL' || run.status === 'ERROR' ? 'critical' : 'new'}>{run.status}</Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd">Started: {new Date(run.startedAt).toLocaleString()}</Text>
          {run.finishedAt && (<Text as="p" variant="bodyMd">Finished: {new Date(run.finishedAt).toLocaleString()}</Text>)}
        </Card>
        <Card>
          <Text as="h3" variant="headingMd">What we saw</Text>
          <Box padding="400" background="bg-surface-active" borderWidth="025" borderRadius="200" borderColor="border" overflowX="scroll">
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify(run.result, null, 2)}</code>
            </pre>
          </Box>
        </Card>
        <Card>
          <Text as="h3" variant="headingMd">Diagnostics</Text>
          <Box padding="400" background="bg-surface-active" borderWidth="025" borderRadius="200" borderColor="border" overflowX="scroll">
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify(run.diagnostics, null, 2)}</code>
            </pre>
          </Box>
        </Card>
        <Card>
          <form method="post">
            <Button submit>Re-run</Button>
          </form>
        </Card>
      </BlockStack>
    </Page>
  );
}


