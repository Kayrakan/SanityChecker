import prisma from "../db.server";
import { consume as rlConsume } from "./rate-limit.server";
export async function requestWithRetry(url, init, attempts = 3, backoffMs = 200) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, init);
            if (res.status === 429 || res.status >= 500) {
                await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
                continue;
            }
            return res;
        }
        catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
        }
    }
    if (lastErr)
        throw lastErr;
    return fetch(url, init);
}
export async function getAdminClient(request) {
    const { authenticate } = await import("../shopify.server");
    const { admin, session } = await authenticate.admin(request);
    return { admin, session };
}
export async function unauthenticatedStorefrontClient(shop, storefrontAccessToken, apiVersion) {
    const endpoint = `https://${shop}/api/${apiVersion ?? "2025-01"}/graphql.json`;
    return {
        async graphql(query, variables) {
            // Basic per-shop rate limiting for Storefront
            try {
                await rlConsume("storefront", shop);
            }
            catch { }
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
// Use the same Admin API version as the app (defaults to the latest set in shopify.server.ts).
// Fall back to 2025-07 to ensure availability of Storefront token APIs.
const ADMIN_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
async function loadOfflineSession(shopDomain) {
    const offlineId = `offline_${shopDomain}`;
    const exact = await prisma.session.findUnique({ where: { id: offlineId } });
    if (exact)
        return { ...exact, shop: shopDomain };
    const last = await prisma.session.findFirst({ where: { shop: shopDomain }, orderBy: { expires: "desc" } });
    return last ? { ...last, shop: shopDomain } : null;
}
export async function getAdminClientByShop(shopDomain) {
    const session = await loadOfflineSession(shopDomain);
    if (!session)
        throw new Error(`Offline admin session not found for ${shopDomain}`);
    const endpoint = `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
    const admin = {
        async graphql(query, variables) {
            try {
                await rlConsume("admin", shopDomain);
            }
            catch { }
            const res = await requestWithRetry(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": session.accessToken,
                },
                body: JSON.stringify({ query, variables }),
            });
            return res;
        },
    };
    return { admin, session };
}
export async function adminGraphqlJson(admin, query, variables) {
    const res = await admin.graphql(query, variables);
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    }
    catch (err) {
        const errMsg = String(text || '').slice(0, 2000);
        throw new Error(`Invalid JSON from Shopify GraphQL: ${errMsg}`);
    }
    if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        const message = json.errors.map((e) => e?.message || 'Unknown').join('; ');
        const error = new Error(`Shopify GraphQL errors: ${message}`);
        error.errors = json.errors;
        error.data = json.data;
        throw error;
    }
    return json;
}
export async function fetchAdminRest(shopDomain, path, init) {
    const session = await loadOfflineSession(shopDomain);
    if (!session)
        throw new Error(`Offline admin session not found for ${shopDomain}`);
    const endpoint = `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/${path.replace(/^\//, "")}`;
    const res = await requestWithRetry(endpoint, {
        method: init?.method || "GET",
        headers: {
            ...(init?.headers || {}),
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
        },
        body: init?.body,
    });
    return res;
}
