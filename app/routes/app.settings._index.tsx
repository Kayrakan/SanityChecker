import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, TextField, BlockStack, Button, InlineStack, Text, Checkbox } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, settings: { create: {} } },
    update: {},
    include: { settings: true },
  });
  return json({ settings: shop.settings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, settings: { create: {} } },
    update: {},
  });
  await prisma.settings.update({
    where: { shopId: shop.id },
    data: {
      dailyRunHourUtc: Number(form.get("dailyRunHourUtc")) || 7,
      promoMode: form.get("promoMode") === "on",
      slackWebhookUrl: String(form.get("slackWebhookUrl") || ""),
      notificationEmail: String(form.get("notificationEmail") || ""),
      // storefront token is provisioned automatically when needed
    },
  });
  return redirect("/app/settings");
};

export default function SettingsIndex() {
  const { settings } = useLoaderData<typeof loader>();
  return (
    <Page title="Settings">
      <Card>
        <Form method="post">
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Scheduling</Text>
            <TextField name="dailyRunHourUtc" label="Daily run hour (UTC)" type="number" defaultValue={String(settings?.dailyRunHourUtc ?? 7)} />
            <Checkbox label="Promo mode (hourly)" name="promoMode" defaultChecked={settings?.promoMode ?? false} />
            <Text as="h3" variant="headingMd">Notifications</Text>
            <TextField name="notificationEmail" label="Notification email" defaultValue={settings?.notificationEmail ?? ''} autoComplete="off" />
            <TextField name="slackWebhookUrl" label="Slack webhook URL" defaultValue={settings?.slackWebhookUrl ?? ''} autoComplete="off" />
            <Text as="h3" variant="headingMd">Storefront API</Text>
            <Text as="p" variant="bodyMd">The app will automatically provision a Storefront access token when needed. No action required.</Text>
            <InlineStack>
              <Button submit variant="primary">Save</Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}


