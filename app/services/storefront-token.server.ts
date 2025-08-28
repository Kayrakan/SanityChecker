import prisma from "../db.server";
import { getAdminClientByShop } from "./shopify-clients.server";

const DEFAULT_STOREFRONT_VERSION = "2025-07";

async function listTokens(admin: any) {
  const res = await admin.graphql(
    `#graphql
    query ListTokens {
      storefrontAccessTokens(first: 100) {
        nodes { id accessToken title createdAt }
      }
    }`
  );
  const json = await res.json();
  return (json?.data?.storefrontAccessTokens?.nodes ?? []) as Array<{ id: string; accessToken: string; createdAt: string; title: string }>;
}

async function deleteToken(admin: any, id: string) {
  await admin.graphql(
    `#graphql
    mutation DeleteToken($id: ID!) {
      storefrontAccessTokenDelete(id: $id) { deletedStorefrontAccessTokenId userErrors { message } }
    }`,
    { id }
  );
}

async function pruneOldTokens(admin: any, keep = 3) {
  const tokens = await listTokens(admin);
  const sorted = tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const toDelete = sorted.slice(keep);
  for (const t of toDelete) {
    await deleteToken(admin, t.id);
  }
}

export async function rotateStorefrontToken(shopDomain: string) {
  const db: any = prisma;
  const shop = await db.shop.findUnique({ where: { domain: shopDomain }, include: { settings: true } });
  if (!shop) throw new Error("Shop not found");
  const { admin } = await getAdminClientByShop(shopDomain);
  await pruneOldTokens(admin, 3);
  const res = await admin.graphql(
    `#graphql
      mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
        storefrontAccessTokenCreate(input: $input) {
          storefrontAccessToken { accessToken accessScopes { handle } title createdAt }
          userErrors { field message }
        }
      }
    `,
    { input: { title: `Sanity Tester ${new Date().toISOString()}` } },
  );
  const json = await res.json();
  const token = json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken as string | undefined;
  if (!token) throw new Error("Failed to rotate Storefront token");
  await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: token, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
  return { token, version: DEFAULT_STOREFRONT_VERSION };
}

export async function ensureStorefrontToken(shopDomain: string) {
  const db: any = prisma;
  const shop = await db.shop.findUnique({ where: { domain: shopDomain }, include: { settings: true } });
  if (!shop) throw new Error("Shop not found");
  if (shop.settings?.storefrontAccessToken) {
    return { token: shop.settings.storefrontAccessToken, version: shop.settings.storefrontApiVersion ?? DEFAULT_STOREFRONT_VERSION };
  }

  const { admin } = await getAdminClientByShop(shopDomain);
  // Try to reuse an existing token from the shop if present
  const existing = await listTokens(admin);
  if (existing.length > 0) {
    const newest = existing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!;
    await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: newest.accessToken, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
    await pruneOldTokens(admin, 3);
    return { token: newest.accessToken, version: DEFAULT_STOREFRONT_VERSION };
  }

  // Otherwise create a new one and prune older ones
  await pruneOldTokens(admin, 3);
  const res = await admin.graphql(
    `#graphql
      mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
        storefrontAccessTokenCreate(input: $input) {
          storefrontAccessToken { accessToken accessScopes { handle } title createdAt }
          userErrors { field message }
        }
      }
    `,
    {
      input: { title: `Sanity Tester ${new Date().toISOString()}` },
    },
  );
  const json = await res.json();
  const token = json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken as string | undefined;
  const userErrors = json?.data?.storefrontAccessTokenCreate?.userErrors ?? [];
  if (!token) {
    throw new Error(`Failed to create Storefront token: ${JSON.stringify(userErrors)}`);
  }
  await db.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: token, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
  return { token, version: DEFAULT_STOREFRONT_VERSION };
}


