import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, TextField, Button, BlockStack, Text } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const scenario = await prisma.scenario.findUnique({ where: { id: String(params.id) } });
  if (!scenario) throw new Response("Not Found", { status: 404 });
  return json({ scenario });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const variantIds = String(form.get("variantIds") || "").split(/\s*,\s*/).filter(Boolean);
  const quantities = String(form.get("quantities") || "").split(/\s*,\s*/).map(v => Number(v) || 1);
  await prisma.scenario.update({ where: { id: String(params.id) }, data: { productVariantIds: variantIds, quantities } });
  return redirect(`/app/scenarios/${params.id}`);
};

export default function ScenarioItems() {
  const { scenario } = useLoaderData<typeof loader>();
  return (
    <Page title="Scenario Items">
      <Card>
        <Form method="post">
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">Enter Storefront variant GIDs separated by commas.</Text>
            <TextField name="variantIds" label="Variant IDs" defaultValue={(scenario.productVariantIds ?? []).join(',')} autoComplete="off" />
            <TextField name="quantities" label="Quantities (comma-separated)" defaultValue={(scenario.quantities ?? []).join(',') || '1'} autoComplete="off" />
            <Button submit variant="primary">Save</Button>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}


