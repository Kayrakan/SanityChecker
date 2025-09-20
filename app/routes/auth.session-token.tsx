import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { addDocumentResponseHeaders, authenticate } from "../shopify.server";

const APP_BRIDGE_URL = "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const reloadParam = url.searchParams.get("shopify-reload");

  const appBase = (() => {
    const candidate = process.env.SHOPIFY_APP_URL || process.env.HOST || "";
    if (candidate) {
      try {
        return new URL(candidate).toString();
      } catch {
        // fall through to default below
      }
    }
    return `${url.protocol}//${url.host}`;
  })();

  const resolvedReloadUrl = (() => {
    if (!reloadParam) {
      return null;
    }
    try {
      return new URL(reloadParam).toString();
    } catch {
      try {
        return new URL(reloadParam, appBase).toString();
      } catch {
        return null;
      }
    }
  })();

  // If Shopify calls this route without a reload target, fall back to our normal auth flow.
  if (!resolvedReloadUrl) {
    await authenticate.admin(request);
    const fallback = url.searchParams.get("from") || "/app";
    throw redirect(fallback);
  }

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  addDocumentResponseHeaders(request, headers);

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script data-api-key="${process.env.SHOPIFY_API_KEY || ""}" src="${APP_BRIDGE_URL}"></script>
  </head>
  <body>
    <script>
      (function redirectToApp(targetUrl) {
        if (!targetUrl) return;
        try {
          var decoded = decodeURIComponent(targetUrl);
        } catch (error) {
          decoded = targetUrl;
        }
        if (window.top && window.top !== window) {
          window.top.location.href = decoded;
        } else {
          window.location.href = decoded;
        }
      })(${JSON.stringify(resolvedReloadUrl)});
    </script>
  </body>
</html>`;

  return new Response(html, { headers });
};
