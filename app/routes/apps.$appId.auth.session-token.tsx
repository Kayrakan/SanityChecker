import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { addDocumentResponseHeaders, authenticate } from "../shopify.server";

const APP_BRIDGE_URL = "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const reloadUrl = url.searchParams.get("shopify-reload");

  // If Shopify calls this route without a reload target, fall back to our normal auth flow.
  if (!reloadUrl) {
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
      })(${JSON.stringify(reloadUrl)});
    </script>
  </body>
</html>`;

  return new Response(html, { headers });
};
