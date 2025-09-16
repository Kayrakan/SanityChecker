import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text, InlineStack, Button, Badge, Banner } from "@shopify/polaris";
import { authenticate, BASIC_PLAN, PRO_PLAN, SCALE_PLAN } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams;
  const from = search.get("from") || "/app";
  const status = await billing.check({ plans: [SCALE_PLAN, PRO_PLAN, BASIC_PLAN] });
  if (status.hasActivePayment) {
    const dest = new URL(from, url);
    dest.search = url.search; // preserve shop/host
    return redirect(dest.toString());
  }
  const reason = search.get("reason") || undefined;
  const cap = Number(search.get("cap") || "0") || undefined;
  const err = search.get("err") || undefined;
  const msg = search.get("msg") || undefined;
  return json({ hasPayment: status.hasActivePayment, reason, cap, err, msg, from });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = String(form.get("plan") || BASIC_PLAN) as typeof BASIC_PLAN | typeof PRO_PLAN | typeof SCALE_PLAN;
  const current = new URL(request.url);
  const from = current.searchParams.get("from") || "/app";
  try {
    const { confirmationUrl } = await billing.request({
      plan,
      returnUrl: (() => { const u = new URL(from, current); u.search = current.search; return u.toString(); })(),
      isTest: process.env.NODE_ENV !== "production",
    });
    return redirect(confirmationUrl);
  } catch (e: any) {
    const to = new URL(current);
    to.searchParams.set("err", "billing_request");
    to.searchParams.set("msg", encodeURIComponent(String(e?.message || "Billing request failed")));
    return redirect(to.toString());
  }
};

export default function BillingPage() {
  const { hasPayment, reason, cap, err, msg } = useLoaderData<typeof loader>();
  return (
    <Page title="Choose a plan">
      <BlockStack gap="400">
        {reason === 'cap' ? (
          <Banner title="Upgrade required" tone="warning">
            <p>You’ve reached your plan’s limit of {cap ?? 10} scenarios.</p>
          </Banner>
        ) : null}
        {err ? (
          <Banner title="Billing error" tone="critical">
            <p>{decodeURIComponent(String(msg || '')) || 'We could not start billing. Please try again.'}</p>
          </Banner>
        ) : null}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">Select a plan to continue. All plans include a 7‑day free trial.</Text>
            <InlineStack gap="400">
              <PlanCard name="Basic" price="$29/mo" features={["Up to 10 scenarios", "Daily runs"]} planId={BASIC_PLAN} />
              <PlanCard name="Pro" price="$59/mo" features={["Up to 30 scenarios", "Daily runs"]} planId={PRO_PLAN} />
              <PlanCard name="Scale" price="$99/mo" features={["Up to 60 scenarios", "Priority support"]} planId={SCALE_PLAN} />
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function PlanCard({ name, price, features, planId }: { name: string; price: string; features: string[]; planId: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingMd">{name}</Text>
        <Text as="p" variant="headingLg">{price}</Text>
        <BlockStack>
          {features.map((f, i) => (
            <Text key={i} as="p" variant="bodySm">• {f}</Text>
          ))}
        </BlockStack>
        <Form method="post">
          <input type="hidden" name="plan" value={planId} />
          <Button submit variant={planId === 'basic' ? 'primary' : undefined}>Select {name}</Button>
        </Form>
      </BlockStack>
    </Card>
  );
}


