import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useLocation } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  BlockStack,
  Button,
  InlineStack,
  Text,
  Select,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getBillingSummary, type BillingSummary } from "../billing/summary.server";
import prisma from "../db.server";
import { useEffect, useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, settings: { create: {} } },
    update: {},
    include: { settings: true },
  });

  const bypassBilling = process.env.NODE_ENV !== "production" && process.env.ENFORCE_BILLING !== "1";
  const billingSummary = await getBillingSummary({ billing, bypassBilling });

  return json({ settings: shop.settings, billing: billingSummary });
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
  const { settings, billing } = useLoaderData<typeof loader>();
  const location = useLocation();
  const manageBillingParams = new URLSearchParams(location.search);
  if (!manageBillingParams.has("from")) {
    manageBillingParams.set("from", location.pathname);
  }
  const manageBillingQuery = manageBillingParams.toString();
  const manageBillingUrl = `/app/billing${manageBillingQuery ? `?${manageBillingQuery}` : ""}`;

  const [hour, setHour] = useState<string>(String(settings?.dailyRunHourUtc ?? 7));
  const hourOptions = Array.from({ length: 24 }).map((_, h) => ({
    label: `${String(h).padStart(2, "0")}:00 UTC`,
    value: String(h),
  }));
  const [localPreview, setLocalPreview] = useState<string>("");
  const [nextRunPreview, setNextRunPreview] = useState<string>("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState<string>(String(settings?.slackWebhookUrl ?? ""));

  const activePlan = resolveActivePlan(billing);
  const trialEndLabel = activePlan?.onTrial && activePlan.trialEndsOn
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(activePlan.trialEndsOn))
    : null;
  const currentPeriodEndLabel = activePlan?.currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(activePlan.currentPeriodEnd))
    : null;

  useEffect(() => {
    const h = Number(hour) || 0;
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0));
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    setLocalPreview(fmt.format(todayUtc));
  }, [hour]);

  useEffect(() => {
    const h = Number(hour) || 0;
    const now = new Date();
    const addDay = now.getUTCHours() >= h ? 1 : 0;
    const nextUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + addDay, h, 0, 0));
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    setNextRunPreview(fmt.format(nextUtc));
  }, [hour]);

  return (
    <Page title="Settings">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <InlineStack gap="200" align="space-between">
              <Text as="h3" variant="headingMd">Billing</Text>
              {activePlan ? (
                <Badge tone={activePlan.status === "ACTIVE" ? "success" : "attention"}>
                  {activePlan.status}
                </Badge>
              ) : null}
            </InlineStack>
            {billing.mode === "development" ? (
              <Text as="p" variant="bodyMd">
                Billing is disabled in development. Set <code>ENFORCE_BILLING=1</code> to test subscription flows.
              </Text>
            ) : activePlan ? (
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  Current plan: <strong>{activePlan.label}</strong>
                  {activePlan.price ? ` • ${activePlan.price}` : ""}
                  {activePlan.test ? " (test charge)" : ""}
                </Text>
                {activePlan.cap ? (
                  <Text as="p" variant="bodySm" tone="subdued">Scenario limit: {activePlan.cap}</Text>
                ) : null}
                {activePlan.onTrial && trialEndLabel ? (
                  <Text as="p" variant="bodySm" tone="subdued">Trial ends on {trialEndLabel}</Text>
                ) : null}
                {currentPeriodEndLabel ? (
                  <Text as="p" variant="bodySm" tone="subdued">Current period ends {currentPeriodEndLabel}</Text>
                ) : null}
              </BlockStack>
            ) : (
              <Text as="p" variant="bodyMd">No active subscription found. Select a plan to continue using the app.</Text>
            )}
            <InlineStack>
              <Button url={manageBillingUrl} variant="primary">Manage billing</Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Merchants can also review app charges from the Shopify Admin under Settings → Billing → App charges.
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <Form method="post">
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">Scheduling</Text>
              <BlockStack gap="100">
                <Select
                  label="Run time (UTC)"
                  options={hourOptions}
                  value={hour}
                  onChange={(value) => setHour(String(value))}
                />
                <Text as="p" variant="bodySm" tone="subdued">Your local time: {localPreview}</Text>
                <Text as="p" variant="bodySm" tone="subdued">Next run: {nextRunPreview}</Text>
                {/* Preserve existing values without exposing UI */}
                <input type="hidden" name="dailyRunHourUtc" value={String(Number(hour) || 0)} />
                <input type="hidden" name="promoMode" value={settings?.promoMode ? "on" : "off"} />
              </BlockStack>
              <Text as="h3" variant="headingMd">Notifications</Text>
              <TextField
                name="slackWebhookUrl"
                label="Slack webhook URL"
                value={slackWebhookUrl}
                onChange={setSlackWebhookUrl}
                autoComplete="off"
                helpText="Paste your Slack Incoming Webhook URL to receive daily digests."
              />
              {/* Email disabled for now; preserve existing value */}
              <input type="hidden" name="notificationEmail" value={settings?.notificationEmail ?? ""} />
              {/* Storefront token handled automatically; preserve existing value */}
              <input type="hidden" name="storefrontAccessToken" value={settings?.storefrontAccessToken ?? ""} />
              <InlineStack>
                <Button submit variant="primary">Save</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}

function resolveActivePlan(summary: BillingSummary | undefined) {
  if (!summary || summary.mode === "development" || !summary.hasActivePayment) {
    return undefined;
  }
  return summary.activePlan;
}
