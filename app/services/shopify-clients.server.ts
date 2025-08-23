import shopify, { authenticate, sessionStorage } from "../shopify.server";

export async function getAdminClient(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  return { admin, session };
}

export async function unauthenticatedStorefrontClient(shop: string, storefrontAccessToken: string, apiVersion?: string) {
  const endpoint = `https://${shop}/api/${apiVersion ?? "2025-01"}/graphql.json`;
  return {
    async graphql(query: string, variables?: Record<string, any>) {
      const res = await fetch(endpoint, {
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
  const session = await sessionStorage.loadSession(offlineId as any);
  if (!session) throw new Error(`Offline admin session not found for ${shopDomain}`);
  const api: any = (shopify as any).api ?? (shopify as any);
  const AdminGraphql = api.clients?.Graphql ?? api.clients?.Rest ?? api.clients?.Graphql; // prefer GraphQL
  const admin = new api.clients.Graphql({ session });
  return { admin, session };
}


