import prisma from "../db.server.js";
import { getAdminClientByShop, adminGraphqlJson, fetchAdminRest } from "./shopify-clients.server.js";
const DEFAULT_STOREFRONT_VERSION = "2025-07";
async function listTokens(admin, shopDomain) {
    try {
        const json = await adminGraphqlJson(admin, `#graphql
    query ListTokens {
      storefrontAccessTokens(first: 100) {
        nodes { id accessToken title createdAt }
      }
    }`);
        return (json?.data?.storefrontAccessTokens?.nodes ?? []);
    }
    catch (err) {
        // Fallback to Admin REST if GraphQL field is unavailable
        try {
            const res = await fetchAdminRest(shopDomain, "storefront_access_tokens.json");
            const text = await res.text();
            const json = JSON.parse(text || "{}");
            const items = Array.isArray(json?.storefront_access_tokens) ? json.storefront_access_tokens : [];
            return items.map((t) => ({ id: String(t.id), accessToken: String(t.access_token || t.accessToken || ""), title: t.title || "", createdAt: t.created_at || t.createdAt }));
        }
        catch (e) {
            throw err;
        }
    }
}
async function deleteToken(admin, shopDomain, id) {
    try {
        await adminGraphqlJson(admin, `#graphql
      mutation DeleteToken($id: ID!) {
        storefrontAccessTokenDelete(id: $id) { deletedStorefrontAccessTokenId userErrors { message } }
      }`, { id });
    }
    catch (err) {
        // Fallback to REST delete
        const numericId = String(id).includes("/") ? String(id).split("/").pop() : id;
        await fetchAdminRest(shopDomain, `storefront_access_tokens/${numericId}.json`, { method: "DELETE" });
    }
}
async function pruneOldTokens(admin, shopDomain, keep = 3) {
    const tokens = await listTokens(admin, shopDomain);
    const sorted = tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const toDelete = sorted.slice(keep);
    for (const t of toDelete) {
        await deleteToken(admin, shopDomain, t.id);
    }
}
export async function rotateStorefrontToken(shopDomain) {
    const db = prisma;
    const shop = await db.shop.findUnique({ where: { domain: shopDomain }, include: { settings: true } });
    if (!shop)
        throw new Error("Shop not found");
    const { admin } = await getAdminClientByShop(shopDomain);
    await pruneOldTokens(admin, shopDomain, 3);
    let token;
    try {
        const json = await adminGraphqlJson(admin, `#graphql
        mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
          storefrontAccessTokenCreate(input: $input) {
            storefrontAccessToken { accessToken accessScopes { handle } title createdAt }
            userErrors { field message }
          }
        }
      `, { input: { title: `Sanity Tester ${new Date().toISOString()}` } });
        token = json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
        const userErrors = json?.data?.storefrontAccessTokenCreate?.userErrors ?? [];
        if (!token)
            throw new Error(`Failed to rotate Storefront token: ${userErrors.map((e) => e?.message).join('; ') || 'Unknown error'}`);
    }
    catch (err) {
        // Fallback to REST create
        const res = await fetchAdminRest(shopDomain, 'storefront_access_tokens.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storefront_access_token: { title: `Sanity Tester ${new Date().toISOString()}` } }),
        });
        const text = await res.text();
        const json = JSON.parse(text || '{}');
        token = json?.storefront_access_token?.access_token;
        if (!token)
            throw err;
    }
    await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: token, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
    return { token, version: DEFAULT_STOREFRONT_VERSION };
}
export async function ensureStorefrontToken(shopDomain) {
    const db = prisma;
    const shop = await db.shop.findUnique({ where: { domain: shopDomain }, include: { settings: true } });
    if (!shop)
        throw new Error("Shop not found");
    if (shop.settings?.storefrontAccessToken) {
        return { token: shop.settings.storefrontAccessToken, version: shop.settings.storefrontApiVersion ?? DEFAULT_STOREFRONT_VERSION };
    }
    const { admin } = await getAdminClientByShop(shopDomain);
    // Try to reuse an existing token from the shop if present
    const existing = await listTokens(admin, shopDomain);
    if (existing.length > 0) {
        const newest = existing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: newest.accessToken, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
        await pruneOldTokens(admin, shopDomain, 3);
        return { token: newest.accessToken, version: DEFAULT_STOREFRONT_VERSION };
    }
    // Otherwise create a new one and prune older ones
    await pruneOldTokens(admin, shopDomain, 3);
    let token;
    try {
        const json = await adminGraphqlJson(admin, `#graphql
        mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
          storefrontAccessTokenCreate(input: $input) {
            storefrontAccessToken { accessToken accessScopes { handle } title createdAt }
            userErrors { field message }
          }
        }
      `, {
            input: { title: `Sanity Tester ${new Date().toISOString()}` },
        });
        token = json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
        const userErrors = json?.data?.storefrontAccessTokenCreate?.userErrors ?? [];
        if (!token) {
            const topErrors = Array.isArray(userErrors) && userErrors.length ? userErrors.map((e) => e?.message).join("; ") : (json?.errors ? json.errors.map((e) => e?.message).join("; ") : "Unknown error");
            throw new Error(`Failed to create Storefront token: ${topErrors}`);
        }
    }
    catch (err) {
        console.log("failed to create storefront token", err);
        // Fallback to REST create
        const res = await fetchAdminRest(shopDomain, 'storefront_access_tokens.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storefront_access_token: { title: `Sanity Tester ${new Date().toISOString()}` } }),
        });
        const text = await res.text();
        const json = JSON.parse(text || '{}');
        token = json?.storefront_access_token?.access_token;
        if (!token)
            throw err;
    }
    await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: token, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
    return { token, version: DEFAULT_STOREFRONT_VERSION };
}
