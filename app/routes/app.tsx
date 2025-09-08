import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigation, useFetchers } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Frame, Loading, Spinner, Text } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const isBusy = navigation.state !== "idle" || fetchers.some((f) => f.state !== "idle");
  const isNavigating = navigation.state !== "idle";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home" prefetch="intent">
          Home
        </Link>
        <Link to="/app/scenarios" prefetch="intent">Scenarios</Link>
        <Link to="/app/runs" prefetch="intent">Runs</Link>
        <Link to="/app/settings" prefetch="intent">Settings</Link>
      </NavMenu>
      <Frame>
        {isBusy && <Loading />}
        {isNavigating && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, borderRadius: 8, background: "rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
              <Spinner accessibilityLabel="Loading page" size="large" />
              <Text as="span" variant="bodySm" tone="subdued">Loading…</Text>
            </div>
          </div>
        )}
        <Outlet />
      </Frame>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
