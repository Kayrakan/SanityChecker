import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text, InlineStack, Button, Badge, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { BASIC_PLAN, PRO_PLAN, SCALE_PLAN } from "../billing/plans";
import { getBillingSummary } from "../billing/summary.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, sessionToken } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams;
  const from = search.get("from") || "/app";
  const reason = search.get("reason") || undefined;
  const cap = Number(search.get("cap") || "0") || undefined;
  const err = search.get("err") || undefined;
  const msg = search.get("msg") || undefined;
  const bypassBilling = process.env.NODE_ENV !== "production" && process.env.ENFORCE_BILLING !== "1";
  const billingSummary = await getBillingSummary({ billing, bypassBilling });
  const hostParam = resolveHostParam({ request, sessionToken });
  const embedded = search.get("embedded") === "1" || sessionToken ? "1" : null;
  return json({
    billing: billingSummary,
    reason,
    cap,
    err,
    msg,
    from,
    hostParam,
    shopDomain: session.shop,
    embedded,
    appUrlInfo: (() => {
      const raw = process.env.SHOPIFY_APP_URL || process.env.HOST || "";
      if (!raw) {
        return { raw: null as string | null, message: "SHOPIFY_APP_URL is not set. Set it to your app server base URL (tunnel/production), e.g., https://your-tunnel.trycloudflare.com.", valid: false };
      }
      try {
        const u = new URL(raw);
        const isAdmin = u.hostname === "admin.shopify.com" || u.hostname.endsWith(".admin.shopify.com");
        const isMyShopify = u.hostname.endsWith("myshopify.com");
        const inAdminPath = u.pathname.startsWith("/admin");
        if (isAdmin || isMyShopify || inAdminPath) {
          return { raw, message: "SHOPIFY_APP_URL points to Shopify Admin or *.myshopify.com. Set it to your app’s public base URL (your tunnel), not an Admin link.", valid: false };
        }
        return { raw, message: null as string | null, valid: true };
      } catch {
        return { raw, message: "SHOPIFY_APP_URL is not a valid URL. Use your tunnel base, e.g., https://your-tunnel.trycloudflare.com.", valid: false };
      }
    })(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, sessionToken } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = String(form.get("plan") || BASIC_PLAN) as typeof BASIC_PLAN | typeof PRO_PLAN | typeof SCALE_PLAN;
  const current = new URL(request.url);
  const host = String(form.get("host") || current.searchParams.get("host") || "");
  const shop = String(form.get("shop") || current.searchParams.get("shop") || session.shop);
  const from = String(form.get("from") || current.searchParams.get("from") || "/app");
  const params = new URLSearchParams(current.search);
  const resolvedHost = host || resolveHostParam({ request, sessionToken });
  if (resolvedHost) {
    params.set("host", resolvedHost);
  } else {
    params.delete("host");
  }
  if (shop) params.set("shop", shop);
  if (from) params.set("from", from);
  const embeddedFlag = String(form.get("embedded") || current.searchParams.get("embedded") || "");
  const shouldEmbed = embeddedFlag === "1" || Boolean(sessionToken);
  if (shouldEmbed) {
    params.set("embedded", "1");
  } else {
    params.delete("embedded");
  }
  const returnUrl = (() => {
    // Always build an absolute URL to our app to avoid any ambiguity with Admin origins
    const base = (() => {
      const candidate = process.env.SHOPIFY_APP_URL || process.env.HOST || "";
      try {
        const u = new URL(candidate);
        const isAdmin = u.hostname === "admin.shopify.com" || u.hostname.endsWith(".admin.shopify.com");
        const isMyShopify = u.hostname.endsWith("myshopify.com");
        const inAdminPath = u.pathname.startsWith("/admin");
        if ((isAdmin || isMyShopify || inAdminPath) && process.env.HOST) {
          return new URL(process.env.HOST);
        }
        return u;
      } catch {
        try {
          return new URL(process.env.HOST || "");
        } catch {
          return new URL(current.toString());
        }
      }
    })();

    // Build a minimal target path to keep returnUrl well under Shopify's 255-char limit
    const targetPath = (() => {
      const normalizedFrom = from && from.trim() ? (from.startsWith("/") ? from : `/${from}`) : "/app";
      const qs = new URLSearchParams();
      if (resolvedHost) qs.set("host", resolvedHost);
      const q = qs.toString();
      return q ? `${normalizedFrom}?${q}` : normalizedFrom;
    })();

    // Redirect directly to our app's /auth/session-token with a SHORT shopify-reload relative path
    const sessionTokenUrl = new URL(base.toString());
    sessionTokenUrl.pathname = "/auth/session-token";
    sessionTokenUrl.search = `shopify-reload=${encodeURIComponent(targetPath)}`;
    return sessionTokenUrl.toString();
  })();
  try {
    return await billing.request({
      plan,
      returnUrl,
      isTest: process.env.NODE_ENV !== "production",
    });
  } catch (e: any) {
    if (e instanceof Response) {
      throw e;
    }
    // Log as much context as possible for diagnosis
    try {
      // eslint-disable-next-line no-console
      console.error('[billing.request] Failed', {
        plan,
        shop,
        returnUrl,
        errorName: e?.name,
        errorMessage: e?.message,
        errorStack: e?.stack,
        error: e,
      });
    } catch {}

    let detailedMsg = '';
    // Attempt to extract details from common Shopify errors
    try {
      const status = e?.response?.status || e?.status;
      const statusText = e?.response?.statusText;
      const parts: string[] = [];
      if (status) parts.push(`status=${status}${statusText ? ` ${statusText}` : ''}`);
      if (e?.response && typeof e.response.text === 'function') {
        const bodyText = await e.response.text();
        if (bodyText) parts.push(String(bodyText).slice(0, 500));
      } else if (e?.response?.errors) {
        parts.push(JSON.stringify(e.response.errors).slice(0, 500));
      } else if (e?.errors) {
        parts.push(JSON.stringify(e.errors).slice(0, 500));
      }
      if (e?.errorData) {
        try { parts.push(JSON.stringify(e.errorData).slice(0, 500)); } catch {}
      }
      detailedMsg = parts.filter(Boolean).join(' — ');
    } catch {}

    const to = new URL(current);
    to.searchParams.set('err', 'billing_request');
    const baseMessage = e?.message || 'Billing request failed';
    const combined = detailedMsg && !String(baseMessage).includes(detailedMsg)
      ? `${baseMessage} — ${detailedMsg}`
      : String(baseMessage);
    to.searchParams.set('msg', encodeURIComponent(combined));
    return redirect(to.toString());
  }
};

export default function BillingPage() {
  const { billing, reason, cap, err, msg, from, hostParam, shopDomain, embedded, appUrlInfo } = useLoaderData<typeof loader>();
  const activePlan = billing.mode === "live" && billing.hasActivePayment ? billing.activePlan : undefined;
  const trialEndLabel = activePlan?.onTrial && activePlan?.trialEndsOn
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(activePlan.trialEndsOn))
    : null;
  return (
    <Page title="Choose a plan">
      <BlockStack gap="400">
        {billing.mode === "development" ? (
          <Banner tone="info" title="Development mode">
            <p>Billing enforcement is disabled locally. Set <code>ENFORCE_BILLING=1</code> to test subscription flows.</p>
          </Banner>
        ) : null}
        {appUrlInfo && appUrlInfo.valid === false ? (
          <Banner tone="critical" title="Invalid app URL configuration">
            <p>{appUrlInfo.message}</p>
            <p>Detected: {String(appUrlInfo.raw || '—')}</p>
            <p>
              Set SHOPIFY_APP_URL to your app’s public base URL (your tunnel), for example:
              <br />
              https://warning-raises-pat-those.trycloudflare.com
              <br />
              Do not use admin.shopify.com or sanitychecker.myshopify.com URLs. Also ensure the Partner Dashboard Application URL matches the same base.
            </p>
          </Banner>
        ) : null}
        {(!hostParam || embedded !== "1") ? (
          <Banner tone="warning" title="Embedded context missing">
            <p>
              We could not confirm embedded context or host parameters. If you see a 404 on sanitychecker.myshopify.com or /apps/.../auth/session-token after approving a plan, it's often due to a password-protected storefront blocking the proxy. We now redirect via our own /auth/session-token, but your app URL must still be reachable.
            </p>
            <p>
              Verify your application_url in shopify.app.toml or in the Partner Dashboard matches your current public URL, and that you launch the app from Shopify Admin. Host: {String(hostParam || '—')}, embedded: {String(embedded || '—')}.
            </p>
          </Banner>
        ) : null}
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
        {activePlan ? (
          <Banner tone="success" title="Current subscription">
            <p>
              You’re on the {activePlan.label} plan{activePlan.price ? ` (${activePlan.price})` : ''}.
              {activePlan.onTrial && trialEndLabel ? ` Trial ends ${trialEndLabel}.` : ''}
            </p>
          </Banner>
        ) : null}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">Select a plan to continue. All plans include a 7‑day free trial.</Text>
            <InlineStack gap="400">
              <PlanCard
                name="Basic"
                price="$29/mo"
                features={["Up to 10 scenarios", "Daily runs"]}
                planId={BASIC_PLAN}
                isActive={activePlan?.planId === BASIC_PLAN}
                isRecommended={!activePlan}
                hostParam={hostParam}
                shopDomain={shopDomain}
                from={from}
                embedded={embedded}
              />
              <PlanCard
                name="Pro"
                price="$59/mo"
                features={["Up to 30 scenarios", "Daily runs"]}
                planId={PRO_PLAN}
                isActive={activePlan?.planId === PRO_PLAN}
                hostParam={hostParam}
                shopDomain={shopDomain}
                from={from}
                embedded={embedded}
              />
              <PlanCard
                name="Scale"
                price="$99/mo"
                features={["Up to 60 scenarios", "Priority support"]}
                planId={SCALE_PLAN}
                isActive={activePlan?.planId === SCALE_PLAN}
                hostParam={hostParam}
                shopDomain={shopDomain}
                from={from}
                embedded={embedded}
              />
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function PlanCard({
  name,
  price,
  features,
  planId,
  isActive,
  isRecommended,
  hostParam,
  shopDomain,
  from,
  embedded,
}: {
  name: string;
  price: string;
  features: string[];
  planId: string;
  isActive?: boolean;
  isRecommended?: boolean;
  hostParam?: string | null;
  shopDomain: string;
  from: string;
  embedded?: string | null;
}) {
  const highlight = isActive || isRecommended;
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">{name}</Text>
          {isActive ? <Badge tone="success">Current</Badge> : null}
        </InlineStack>
        <Text as="p" variant="headingLg">{price}</Text>
        <BlockStack>
          {features.map((f, i) => (
            <Text key={i} as="p" variant="bodySm">• {f}</Text>
          ))}
        </BlockStack>
        <Form method="post">
          <input type="hidden" name="plan" value={planId} />
          {hostParam ? <input type="hidden" name="host" value={hostParam} /> : null}
          <input type="hidden" name="shop" value={shopDomain} />
          <input type="hidden" name="from" value={from} />
          {embedded === "1" ? <input type="hidden" name="embedded" value="1" /> : null}
          <Button submit variant={highlight ? "primary" : undefined} disabled={isActive}>
            {isActive ? 'Current plan' : `Select ${name}`}
          </Button>
        </Form>
      </BlockStack>
    </Card>
  );
}

function resolveHostParam({ request, sessionToken }: { request: Request; sessionToken?: { dest?: unknown } | null }) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("host");
  if (fromQuery) {
    return fromQuery;
  }
  return deriveHostFromSessionToken(sessionToken);
}

function deriveHostFromSessionToken(sessionToken?: { dest?: unknown } | null) {
  if (!sessionToken || typeof sessionToken !== "object") {
    return null;
  }
  try {
    const dest = typeof sessionToken.dest === "string" ? sessionToken.dest : null;
    if (!dest) {
      return null;
    }
    const destUrl = new URL(dest);
    const normalizedPath = destUrl.pathname === "/" ? "" : destUrl.pathname;
    const rawHost = `${destUrl.host}${normalizedPath}`;
    if (!rawHost) {
      return null;
    }
    return Buffer.from(rawHost, "utf-8").toString("base64");
  } catch (error) {
    return null;
  }
}
