import prisma from "../db.server";
import { getAdminClientByShop } from "./shopify-clients.server";

const DEFAULT_STOREFRONT_VERSION = "2025-01";

export async function ensureStorefrontToken(shopDomain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, include: { settings: true } });
  if (!shop) throw new Error("Shop not found");
  if (shop.settings?.storefrontAccessToken) {
    return { token: shop.settings.storefrontAccessToken, version: shop.settings.storefrontApiVersion ?? DEFAULT_STOREFRONT_VERSION };
  }

  const { admin } = await getAdminClientByShop(shopDomain);
  const res = await admin.query({
    data: {
      query: `#graphql
        mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
          storefrontAccessTokenCreate(input: $input) {
            storefrontAccessToken { accessToken accessScopes { handle } title createdAt }
            userErrors { field message }
          }
        }
      `,
      variables: {
        input: { title: `Sanity Tester ${new Date().toISOString()}` },
      },
    },
  });
  const json = await res.json();
  const token = json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken as string | undefined;
  const userErrors = json?.data?.storefrontAccessTokenCreate?.userErrors ?? [];
  if (!token) {
    throw new Error(`Failed to create Storefront token: ${JSON.stringify(userErrors)}`);
  }
  await prisma.settings.update({ where: { shopId: shop.id }, data: { storefrontAccessToken: token, storefrontApiVersion: DEFAULT_STOREFRONT_VERSION } });
  return { token, version: DEFAULT_STOREFRONT_VERSION };
}


