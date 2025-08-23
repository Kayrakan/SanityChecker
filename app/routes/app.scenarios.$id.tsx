import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, TextField, Button, BlockStack, InlineStack, Checkbox, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const scenario = await prisma.scenario.findUnique({ where: { id: String(params.id) } });
  if (!scenario) throw new Response("Not Found", { status: 404 });
  return json({ scenario });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(params.id);
  const intent = String(form.get("intent"));
  if (intent === "save") {
    await prisma.scenario.update({
      where: { id },
      data: {
        name: String(form.get("name")),
        active: form.get("active") === "on",
        countryCode: String(form.get("countryCode")),
        postalCode: String(form.get("postalCode") || ""),
        provinceCode: String(form.get("provinceCode") || ""),
        expectations: {
          freeShippingThreshold: form.get("freeShippingThreshold") ? Number(form.get("freeShippingThreshold")) : undefined,
          min: form.get("minPrice") ? Number(form.get("minPrice")) : undefined,
          max: form.get("maxPrice") ? Number(form.get("maxPrice")) : undefined,
          currency: String(form.get("currency") || "") || undefined,
        } as any,
      },
    });
    return redirect(`/app/scenarios/${id}`);
  }
  return redirect(`/app/scenarios/${id}`);
};

export default function ScenarioDetail() {
  const { scenario } = useLoaderData<typeof loader>();
  return (
    <Page title="Scenario">
      <BlockStack gap="400">
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <BlockStack gap="200">
              <TextField label="Name" name="name" defaultValue={scenario.name} autoComplete="off" />
              <Checkbox label="Active" name="active" defaultChecked={scenario.active} />
              <InlineStack gap="400">
                <TextField label="Country code" name="countryCode" defaultValue={scenario.countryCode} />
                <TextField label="Postal code" name="postalCode" defaultValue={scenario.postalCode ?? ''} />
                <TextField label="Province code" name="provinceCode" defaultValue={scenario.provinceCode ?? ''} />
              </InlineStack>
              <InlineStack gap="400">
                <TextField label="Free shipping threshold" name="freeShippingThreshold" type="number" defaultValue={String((scenario.expectations as any)?.freeShippingThreshold ?? '')} />
                <TextField label="Min price" name="minPrice" type="number" defaultValue={String((scenario.expectations as any)?.min ?? '')} />
                <TextField label="Max price" name="maxPrice" type="number" defaultValue={String((scenario.expectations as any)?.max ?? '')} />
                <TextField label="Currency (ISO)" name="currency" defaultValue={String((scenario.expectations as any)?.currency ?? '')} autoComplete="off" />
              </InlineStack>
              <InlineStack>
                <Button submit variant="primary">Save</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
        <Card>
          <Text as="h3" variant="headingMd">Cart items</Text>
          <Text variant="bodyMd" as="p">Manage variant IDs and quantities.</Text>
          <InlineStack>
            <Button url={`/app/scenarios/${scenario.id}/items`}>
              Edit items
            </Button>
          </InlineStack>
        </Card>
      </BlockStack>
    </Page>
  );
}


