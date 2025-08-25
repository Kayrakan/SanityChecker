import { ensureStorefrontToken } from "./storefront-token.server";
import { unauthenticatedStorefrontClient } from "./shopify-clients.server";
import prisma from "../db.server";

export type VariantInfo = { id: string; title: string; productTitle: string; requiresShipping: boolean; grams: number; priceAmount?: number; priceCurrency?: string; shippingProfileName?: string };

export async function fetchVariantInfos(shopDomain: string, ids: string[]): Promise<VariantInfo[]> {
  if (ids.length === 0) return [];
  const { token, version } = await ensureStorefrontToken(shopDomain);
  const client = await unauthenticatedStorefrontClient(shopDomain, token, version);
  const res = await client.graphql(`
    #graphql
    query Variants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          title
          requiresShipping
          weight
          weightUnit
          price { amount currencyCode }
          product { title }
        }
      }
    }
  `, { ids });
  const json = await res.json();
  const nodes: any[] = json?.data?.nodes ?? [];
  return nodes.filter(Boolean).map((n: any) => {
    const grams = Number(n.weight ?? 0) * (n.weightUnit === 'KILOGRAMS' ? 1000 : n.weightUnit === 'POUNDS' ? 453.592 : n.weightUnit === 'OUNCES' ? 28.3495 : 1);
    return {
      id: n.id,
      title: n.title,
      productTitle: n.product?.title ?? '',
      requiresShipping: !!n.requiresShipping,
      grams: isNaN(grams) ? 0 : Math.round(grams),
      priceAmount: n.price?.amount ? Number(n.price.amount) : undefined,
      priceCurrency: n.price?.currencyCode,
    } as VariantInfo;
  });
}


