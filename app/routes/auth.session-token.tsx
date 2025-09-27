import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { addDocumentResponseHeaders, authenticate } from "../shopify.server";

const APP_BRIDGE_URL = "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log('url');
  console.log(url);
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
      const absolute = new URL(reloadParam).toString();
      try {
        // eslint-disable-next-line no-console
        console.info("[auth.session-token] Resolved absolute reload", { reloadParam, resolved: absolute });
      } catch {}
      return absolute;
    } catch {
      try {
        const relative = new URL(reloadParam, appBase).toString();
        try {
          // eslint-disable-next-line no-console
          console.info("[auth.session-token] Resolved relative reload", { reloadParam, appBase, resolved: relative });
        } catch {}
        return relative;
      } catch {
        return null;
      }
    }
  })();

  // If Shopify calls this route without a reload target, fall back to our normal auth flow.
  if (!resolvedReloadUrl) {
    try {
      // eslint-disable-next-line no-console
      console.warn("[auth.session-token] Missing reload target, falling back to auth", { reloadParam, appBase });
    } catch {}
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
