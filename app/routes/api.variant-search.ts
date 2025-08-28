import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { adminGraphqlJson, getAdminClientByShop } from "../services/shopify-clients.server";

// Simple in-memory cache for 60s
const CACHE_TTL_MS = 60_000;
let lastKey = "";
let lastValue: any = null;
let lastTs = 0;

function ok<T>(data: T, init?: number | ResponseInit) { return json(data as any, init as any); }
function bad(message: string, code = 400) { return ok({ error: message }, { status: code }); }

function buildKey(url: URL) {
  const params = new URLSearchParams(url.search);
  // Ensure stable order
  const ordered = Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b));
  return ordered.map(([k,v]) => `${k}=${v}`).join("&");
}

function toBool(v: string | null): boolean | undefined {
  if (v == null || v === "") return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function toNum(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function gramsFrom(weight: number | null | undefined, unit: string | null | undefined): number {
  const w = Number(weight ?? 0);
  switch (unit) {
    case "KILOGRAMS": return Math.round(w * 1000);
    case "POUNDS": return Math.round(w * 453.592);
    case "OUNCES": return Math.round(w * 28.3495);
    case "GRAMS": default: return Math.round(w);
  }
}

function normalizeVariant(node: any, product: any) {
  const levels = node?.inventoryItem?.inventoryLevels?.edges ?? [];
  const inventory = levels.reduce((sum: number, e: any) => sum + (Number(e?.node?.available ?? 0) || 0), 0);
  const grams = gramsFrom(node?.weight, node?.weightUnit);
  const imageUrl = node?.image?.url || product?.featuredImage?.url || null;
  const price = node?.price ? Number(node.price) : undefined;
  const currencyCode = product?.presentmentCurrencyCode || undefined; // Not always available; best effort
  return {
    id: node?.id,
    productId: product?.id,
    productTitle: product?.title,
    variantTitle: node?.title,
    sku: node?.sku || "",
    imageUrl,
    price,
    currencyCode,
    grams,
    weightKg: grams / 1000,
    requiresShipping: !!node?.requiresShipping,
    inventory,
    vendor: product?.vendor || "",
    productType: product?.productType || "",
  };
}

function buildVariantQueryString({ term, vendor, productType }: { term?: string; vendor?: string; productType?: string; }) {
  const parts: string[] = [];
  parts.push("status:active");
  if (term) {
    const t = term.replace(/\"/g, '\\"');
    // Match SKU exactly and title loosely
    parts.push(`(sku:${t} OR title:*${t}*)`);
  }
  if (vendor) parts.push(`product_vendor:${JSON.stringify(vendor)}`);
  if (productType) parts.push(`product_type:${JSON.stringify(productType)}`);
  return parts.join(" ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const term = (url.searchParams.get("term") || "").trim();
  const collectionId = (url.searchParams.get("collectionId") || "").trim();
  const vendor = (url.searchParams.get("vendor") || "").trim();
  const productType = (url.searchParams.get("productType") || "").trim();
  const requiresShipping = toBool(url.searchParams.get("requiresShipping"));
  const inStock = toBool(url.searchParams.get("inStock"));
  const minWeight = toNum(url.searchParams.get("minWeight"));
  const maxWeight = toNum(url.searchParams.get("maxWeight"));
  const minPrice = toNum(url.searchParams.get("minPrice"));
  const maxPrice = toNum(url.searchParams.get("maxPrice"));
  const sort = (url.searchParams.get("sort") || "TITLE").toUpperCase();
  const direction = (url.searchParams.get("direction") || "ASC").toUpperCase();
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") || 25)));
  let after = url.searchParams.get("cursor") || undefined;

  const restrictive = !!collectionId || !!vendor || !!productType;
  if (term.length > 0 && term.length < 2 && !restrictive) {
    return bad("Type at least 2 characters or choose a Collection to search.", 400);
  }

  const cacheKey = buildKey(url);
  if (cacheKey === lastKey && Date.now() - lastTs < CACHE_TTL_MS && lastValue) {
    return ok(lastValue);
  }

  const { admin } = await getAdminClientByShop(session.shop);

  const items: any[] = [];
  let hasNextPage = false;
  let endCursor: string | null = null;

  const sortKey = ["TITLE","SKU"].includes(sort) ? sort : "TITLE";
  const reverse = direction === "DESC";

  // Helper to apply post-filters
  function passesFilters(v: any): boolean {
    if (requiresShipping !== undefined && !!v.requiresShipping !== requiresShipping) return false;
    if (inStock !== undefined) {
      const stockOk = inStock ? (v.inventory > 0) : (v.inventory === 0);
      if (!stockOk) return false;
    }
    if (minWeight !== undefined && v.grams < Math.round(minWeight * 1000)) return false;
    if (maxWeight !== undefined && v.grams > Math.round(maxWeight * 1000)) return false;
    if (minPrice !== undefined && (v.price == null || v.price < minPrice)) return false;
    if (maxPrice !== undefined && (v.price == null || v.price > maxPrice)) return false;
    return true;
  }

  // Decide query shape
  const useProductFirst = !!collectionId || (!term && (vendor || productType));

  // We'll fetch up to 5 pages to fill requested page, respecting rate limits implicitly via retry
  let safety = 5;
  let nextAfter: string | undefined = after;

  while (items.length < pageSize && safety-- > 0) {
    if (useProductFirst) {
      const qParts = ["status:active"] as string[];
      if (collectionId) qParts.push(`collection_id:${JSON.stringify(collectionId)}`);
      if (vendor) qParts.push(`vendor:${JSON.stringify(vendor)}`);
      if (productType) qParts.push(`product_type:${JSON.stringify(productType)}`);
      if (term) qParts.push(`title:*${term.replace(/\"/g, '\\"')}*`);
      const query = qParts.join(" ");
      const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Products($first:Int!,$after:String,$query:String!){\n  products(first:$first,after:$after,query:$query,sortKey:TITLE){\n    edges{ cursor node{ id title vendor productType status featuredImage{url} variants(first:50){ edges{ node{ id title sku requiresShipping weight weightUnit price image{url} inventoryItem{ inventoryLevels(first:10){ edges{ node{ available } } } } } } } } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: 50, after: nextAfter, query });
      const edges = data?.data?.products?.edges || [];
      for (const e of edges) {
        const p = e?.node;
        if (!p || p?.status !== "ACTIVE") continue;
        const vEdges = p?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve?.node;
          if (!v) continue;
          const row = normalizeVariant(v, p);
          if (passesFilters(row)) items.push(row);
          if (items.length >= pageSize) break;
        }
        if (items.length >= pageSize) break;
      }
      hasNextPage = !!data?.data?.products?.pageInfo?.hasNextPage;
      endCursor = data?.data?.products?.pageInfo?.endCursor ?? null;
      nextAfter = endCursor ?? undefined;
      if (!hasNextPage) break;
    } else {
      const query = buildVariantQueryString({ term, vendor, productType });
      const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Variants($first:Int!,$after:String,$query:String!,$sortKey:ProductVariantSortKeys,$reverse:Boolean){\n  productVariants(first:$first,after:$after,query:$query,sortKey:$sortKey,reverse:$reverse){\n    edges{ cursor node{ id title sku requiresShipping weight weightUnit price image{url} product{ id title vendor productType status featuredImage{url} } inventoryItem{ inventoryLevels(first:10){ edges{ node{ available } } } } } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: 50, after: nextAfter, query, sortKey, reverse });
      const edges = data?.data?.productVariants?.edges || [];
      for (const e of edges) {
        const v = e?.node;
        if (!v) continue;
        const p = v?.product;
        if (!p || p?.status !== "ACTIVE") continue;
        const row = normalizeVariant(v, p);
        if (passesFilters(row)) items.push(row);
        if (items.length >= pageSize) break;
      }
      hasNextPage = !!data?.data?.productVariants?.pageInfo?.hasNextPage;
      endCursor = data?.data?.productVariants?.pageInfo?.endCursor ?? null;
      nextAfter = endCursor ?? undefined;
      if (!hasNextPage) break;
    }
    if (items.length < pageSize && hasNextPage) {
      // Gentle rate limiting ~1.5 req/s
      await new Promise((r) => setTimeout(r, 650));
    }
  }

  // If sorting by weight/price globally isn't supported, we can post-sort within this page only
  if (sort === "PRICE") {
    items.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    if (reverse) items.reverse();
  } else if (sort === "WEIGHT") {
    items.sort((a, b) => a.grams - b.grams);
    if (reverse) items.reverse();
  }

  const payload = { items, pageInfo: { hasNextPage, endCursor }, sort, direction };
  lastKey = cacheKey; lastValue = payload; lastTs = Date.now();
  return ok(payload);
};

export default null;
