import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { adminGraphqlJson, getAdminClientByShop } from "../services/shopify-clients.server";
import { fetchVariantInfos } from "../services/variants.server";

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

function asNumberMoney(m: any): number | undefined {
  if (m == null) return undefined;
  if (typeof m === 'object') {
    const n = Number(m?.amount);
    return isNaN(n) ? undefined : n;
  }
  const n = Number(m);
  return isNaN(n) ? undefined : n;
}

function normalizeVariant(node: any, product: any) {
  const levels = node?.inventoryItem?.inventoryLevels?.edges ?? [];
  const inventoryQty = levels.reduce((sum: number, e: any) => {
    const qs = e?.node?.quantities ?? [];
    const available = Array.isArray(qs)
      ? qs.find((q: any) => String(q?.name || '').toUpperCase() === 'AVAILABLE')
      : undefined;
    const qty = Number(available?.quantity ?? 0) || 0;
    return sum + qty;
  }, 0);
  const imageUrl = node?.image?.url || product?.featuredImage?.url || null;
  return {
    id: node?.id,
    productId: product?.id,
    productTitle: product?.title,
    variantTitle: node?.title,
    sku: node?.sku || "",
    imageUrl,
    price: asNumberMoney((node as any)?.price),
    currencyCode: undefined as string | undefined,
    grams: 0,
    weightKg: 0,
    requiresShipping: true,
    inventory: inventoryQty,
    vendor: product?.vendor || "",
    productType: product?.productType || "",
  };
}

function buildVariantQueryString({ term, vendor, productType }: { term?: string; vendor?: string; productType?: string; }) {
  const parts: string[] = [];
  // Ensure query is never blank and restrict to active parent products
  parts.push("product_status:active");
  if (term) {
    const tokens = String(term).trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const clauses = tokens.map((tok) => {
        const safe = tok.replace(/["\\]/g, "");
        return `((sku:*${safe}*) OR (title:*${safe}*) OR (product_title:*${safe}*))`;
      });
      parts.push(clauses.join(" AND "));
    }
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
  console.log(`[variant-search] term="${term}", restrictive=${restrictive}, collectionId="${collectionId}", vendor="${vendor}", productType="${productType}"`);
  
  // Allow single-character searches; earlier guard was too strict for users

  const cacheKey = buildKey(url);
  if (cacheKey === lastKey && Date.now() - lastTs < CACHE_TTL_MS && lastValue) {
    return ok(lastValue);
  }

  const { admin } = await getAdminClientByShop(session.shop);

  const rawItems: any[] = [];
  let hasNextPage = false;
  let endCursor: string | null = null;

  const sortKey = ["TITLE","SKU"].includes(sort) ? sort : "TITLE";
  const reverse = direction === "DESC";

  // Helper to apply post-filters (after enrichment)
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

  // Decide query shape - use product query only when we have collection or vendor/type filters without search term
  const useProductFirst = !!collectionId || (!term && (vendor || productType));
  console.log(`[variant-search] useProductFirst=${useProductFirst}, term="${term}"`);
  
  // If no filters at all, show initial results
  if (!term && !collectionId && !vendor && !productType) {
    console.log(`[variant-search] No filters - showing initial results`);
  }

  // We'll fetch up to 5 pages to fill requested page, respecting rate limits implicitly via retry
  let safety = 5;
  let nextAfter: string | undefined = after;

  let filledWithinBatch = false;
  try {
    while (rawItems.length < pageSize && safety-- > 0) {
      if (useProductFirst) {
        const qParts = ["status:active"] as string[];
        if (collectionId) {
          // Accept either a numeric ID or a GID and normalize to numeric for search syntax
          const collNumeric = (collectionId.match(/\d+$/)?.[0]) || collectionId;
          qParts.push(`collection_id:${collNumeric}`);
        }
        if (vendor) qParts.push(`vendor:${JSON.stringify(vendor)}`);
        if (productType) qParts.push(`product_type:${JSON.stringify(productType)}`);
        if (term) {
          const tokens = String(term).trim().split(/\s+/).filter(Boolean);
          if (tokens.length > 0) {
            const clauses = tokens.map((tok) => {
              const safe = tok.replace(/["\\]/g, "");
              return `((sku:*${safe}*) OR (title:*${safe}*))`;
            });
            qParts.push(clauses.join(" AND "));
          }
        }
        const query = qParts.join(" ");
        console.log(`[variant-search] Product query: "${query}"`);
        const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Products($first:Int!,$after:String,$query:String!){\n  products(first:$first,after:$after,query:$query,sortKey:TITLE){\n    edges{ cursor node{ id title vendor productType status featuredImage{url} variants(first:50){ edges{ node{ id title sku image{url} price inventoryItem{ inventoryLevels(first:10){ edges{ node{ quantities(names: [\"available\"]) { name quantity } } } } } } } } } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: 50, after: nextAfter, query });
        const edges = data?.data?.products?.edges || [];
        for (const e of edges) {
          const p = e?.node;
          if (!p || p?.status !== "ACTIVE") continue;
          const vEdges = p?.variants?.edges || [];
          for (const ve of vEdges) {
            const v = ve?.node;
            if (!v) continue;
            const row = normalizeVariant(v, p);
            rawItems.push(row);
            if (rawItems.length >= pageSize) { filledWithinBatch = true; break; }
          }
          if (rawItems.length >= pageSize) break;
        }
        hasNextPage = !!data?.data?.products?.pageInfo?.hasNextPage;
        endCursor = data?.data?.products?.pageInfo?.endCursor ?? null;
        nextAfter = endCursor ?? undefined;
        if (!hasNextPage) break;
      } else {
        const query = buildVariantQueryString({ term, vendor, productType });
        console.log(`[variant-search] Variant query: "${query}"`);
        const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Variants($first:Int!,$after:String,$query:String!,$sortKey:ProductVariantSortKeys,$reverse:Boolean){\n  productVariants(first:$first,after:$after,query:$query,sortKey:$sortKey,reverse:$reverse){\n    edges{ cursor node{ id title sku image{url} price product{ id title vendor productType status featuredImage{url} } inventoryItem{ inventoryLevels(first:10){ edges{ node{ quantities(names: [\"available\"]) { name quantity } } } } } } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: 50, after: nextAfter, query, sortKey, reverse });
        const edges = data?.data?.productVariants?.edges || [];
        for (const e of edges) {
          const v = e?.node;
          if (!v) continue;
          const p = v?.product;
          if (!p || p?.status !== "ACTIVE") continue;
          const row = normalizeVariant(v, p);
          rawItems.push(row);
          if (rawItems.length >= pageSize) { filledWithinBatch = true; break; }
        }
        hasNextPage = !!data?.data?.productVariants?.pageInfo?.hasNextPage;
        endCursor = data?.data?.productVariants?.pageInfo?.endCursor ?? null;
        nextAfter = endCursor ?? undefined;
        if (!hasNextPage) break;
      }
      if (rawItems.length < pageSize && hasNextPage) {
        // Gentle rate limiting ~1.5 req/s
        await new Promise((r) => setTimeout(r, 650));
      }
    }
  } catch (err: any) {
    const message = String(err?.message || "We couldn’t reach Shopify right now—retry in a moment.");
    return bad(message, 502);
  }

  // Fallback: if variant search yielded nothing for a term-only search, try a product-first pass
  try {
    if (rawItems.length === 0 && term && !useProductFirst) {
      const qParts = ["status:active"] as string[];
      const tokens = String(term).trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const clauses = tokens.map((tok) => {
          const w = JSON.stringify(`*${tok}*`);
          return `((sku:${w}) OR (title:${w}))`;
        });
        qParts.push(clauses.join(" AND "));
      }
      if (vendor) qParts.push(`vendor:${JSON.stringify(vendor)}`);
      if (productType) qParts.push(`product_type:${JSON.stringify(productType)}`);
      const query = qParts.join(" ");
      const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Products($first:Int!,$after:String,$query:String!){\n  products(first:$first,after:$after,query:$query,sortKey:TITLE){\n    edges{ cursor node{ id title vendor productType status featuredImage{url} variants(first:50){ edges{ node{ id title sku image{url} price inventoryItem{ inventoryLevels(first:10){ edges{ node{ quantities(names: [\"available\"]) { name quantity } } } } } } } } } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: 50, after: undefined, query });
      const edges = data?.data?.products?.edges || [];
      for (const e of edges) {
        const p = e?.node;
        if (!p || p?.status !== "ACTIVE") continue;
        const vEdges = p?.variants?.edges || [];
        for (const ve of vEdges) {
          const v = ve?.node;
          if (!v) continue;
          const row = normalizeVariant(v, p);
          rawItems.push(row);
          if (rawItems.length >= pageSize) break;
        }
        if (rawItems.length >= pageSize) break;
      }
    }
  } catch {}

  // Enrich via Storefront API for price/weight/requiresShipping
  try {
    if (rawItems.length > 0) {
      const infos = await fetchVariantInfos(session.shop, rawItems.map(r => r.id));
      const map = new Map(infos.map(i => [i.id, i]));
      for (const r of rawItems) {
        const i = map.get(r.id);
        if (i) {
          r.grams = i.grams ?? 0;
          r.weightKg = (r.grams || 0) / 1000;
          r.requiresShipping = !!i.requiresShipping;
          r.price = i.priceAmount;
          r.currencyCode = i.priceCurrency;
          if (i.productTitle) r.productTitle = i.productTitle;
        }
      }
    }
  } catch {}

  // Apply filters that rely on enrichment
  let items = rawItems.filter(passesFilters);

  // Post-sort within page for PRICE/WEIGHT
  if (sort === "PRICE") {
    items.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    if (reverse) items.reverse();
  } else if (sort === "WEIGHT") {
    items.sort((a, b) => a.grams - b.grams);
    if (reverse) items.reverse();
  }

  const payload = { items: items.slice(0, pageSize), pageInfo: { hasNextPage: (hasNextPage || filledWithinBatch || items.length > pageSize), endCursor }, sort, direction };
  console.log(`[variant-search] Returning ${payload.items.length} items, hasNextPage=${payload.pageInfo.hasNextPage}`);
  lastKey = cacheKey; lastValue = payload; lastTs = Date.now();
  return ok(payload);
};

export default null;
