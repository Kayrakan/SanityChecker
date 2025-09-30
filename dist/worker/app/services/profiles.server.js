// Minimal stub; profiles info is optional in the UI
import { adminGraphqlJson, getAdminClientByShop } from "./shopify-clients.server.js";
export async function fetchDeliveryProfilesForVariants(shopDomain, ids) {
    if (ids.length === 0)
        return [];
    const { admin } = await getAdminClientByShop(shopDomain);
    // Using Admin GraphQL to fetch each variant's delivery profile name via sellingPlanGroup or fulfillment service is non-trivial.
    // We approximate profile via product's delivery profile (requires the 2025-01 API: deliveryProfile on ProductVariant is not exposed; use product.deliveryProfile.name when available).
    const data = await adminGraphqlJson(admin, `#graphql\nquery VariantProfiles($ids:[ID!]!){\n  nodes(ids:$ids){\n    ... on ProductVariant { id product{ id title deliveryProfile{ name } } }\n  }\n}`, { ids });
    const nodes = data?.data?.nodes || [];
    return nodes.map((n) => n?.product?.deliveryProfile?.name || "");
}
