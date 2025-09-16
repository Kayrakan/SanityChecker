import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, TextField, BlockStack, Button, InlineStack, Text, Select } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useEffect, useState } from "react";

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
      storefrontAccessToken: (String(form.get("storefrontAccessToken") || "").trim() || undefined),
    },
  });
  return redirect("/app/settings");
};

export default function SettingsIndex() {
  const { settings } = useLoaderData<typeof loader>();
  const [hour, setHour] = useState<string>(String(settings?.dailyRunHourUtc ?? 7));
  const hourOptions = Array.from({ length: 24 }).map((_, h) => ({ label: `${String(h).padStart(2, '0')}:00 UTC`, value: String(h) }));
  const [localPreview, setLocalPreview] = useState<string>("");
  const [nextRunPreview, setNextRunPreview] = useState<string>("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState<string>(String(settings?.slackWebhookUrl ?? ''));

  useEffect(() => {
    const h = Number(hour) || 0;
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0));
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    setLocalPreview(fmt.format(todayUtc));
  }, [hour]);

  useEffect(() => {
    const h = Number(hour) || 0;
    const now = new Date();
    const addDay = now.getUTCHours() >= h ? 1 : 0;
    const nextUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + addDay, h, 0, 0));
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    setNextRunPreview(fmt.format(nextUtc));
  }, [hour]);
  return (
    <Page title="Settings">
      <Card>
        <Form method="post">
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Scheduling</Text>
            <BlockStack gap="100">
              <Select
                label="Run time (UTC)"
                options={hourOptions}
                value={hour}
                onChange={(v) => setHour(String(v))}
              />
              <Text as="p" variant="bodySm" tone="subdued">Your local time: {localPreview}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Next run: {nextRunPreview}</Text>
              {/* Preserve existing values without exposing UI */}
              <input type="hidden" name="dailyRunHourUtc" value={String(Number(hour) || 0)} />
              <input type="hidden" name="promoMode" value={settings?.promoMode ? 'on' : 'off'} />
            </BlockStack>
            <Text as="h3" variant="headingMd">Notifications</Text>
            <TextField name="slackWebhookUrl" label="Slack webhook URL" value={slackWebhookUrl} onChange={setSlackWebhookUrl} autoComplete="off" helpText="Paste your Slack Incoming Webhook URL to receive daily digests." />
            {/* Email disabled for now; preserve existing value */}
            <input type="hidden" name="notificationEmail" value={settings?.notificationEmail ?? ''} />
            {/* Storefront token handled automatically; preserve existing value */}
            <input type="hidden" name="storefrontAccessToken" value={settings?.storefrontAccessToken ?? ''} />
            <InlineStack>
              <Button submit variant="primary">Save</Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}


