import shopify, { authenticate, sessionStorage, apiVersion } from "../shopify.server";
import prisma from "../db.server";

async function requestWithRetry(url: string, init: RequestInit, attempts = 3, backoffMs = 200): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
    }
  }
  if (lastErr) throw lastErr;
  return fetch(url, init);
}

export async function getAdminClient(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  return { admin, session };
}

export async function unauthenticatedStorefrontClient(shop: string, storefrontAccessToken: string, apiVersion?: string) {
  const endpoint = `https://${shop}/api/${apiVersion ?? "2025-01"}/graphql.json`;
  return {
    async graphql(query: string, variables?: Record<string, any>) {
      const res = await requestWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": storefrontAccessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      return res;
    },
  };
}

export async function getAdminClientByShop(shopDomain: string) {
  const offlineId = `offline_${shopDomain}`;
  let session = await sessionStorage.loadSession(offlineId as any);
  if (!session) {
    // Fallback to latest available session for this shop (online), best-effort
    const last = await (prisma as any).session.findFirst({ where: { shop: shopDomain }, orderBy: { expires: "desc" } });
    if (last) {
      session = { ...last, shop: shopDomain } as any;
    }
  }
  if (!session) throw new Error(`Offline admin session not found for ${shopDomain}`);
  const version = String(apiVersion);
  const endpoint = `https://${shopDomain}/admin/api/${version}/graphql.json`;
  const admin = {
    async graphql(query: string, variables?: Record<string, any>) {
      const res = await requestWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": (session as any).accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      return res;
    },
  };
  return { admin, session };
}


