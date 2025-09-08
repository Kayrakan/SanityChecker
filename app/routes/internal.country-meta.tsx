import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCountryMeta } from "../services/country-meta.server";
import { cacheGetJson, cacheSetJson } from "../services/cache.server";

type CacheEntry = { ts: number; value: any };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({});
  console.log(`[country-meta] request`, { shop: session.shop, countryCode });
  const key = `${session.shop}|${countryCode.toUpperCase()}`;
  const hit = await cacheGetJson<any>("country-meta", key);
  if (hit) {
    return json(hit, { headers: { 'Cache-Control': 'private, max-age=3600', 'X-Cache': 'HIT' } });
  }
  const meta = await getCountryMeta(session.shop, countryCode);
  console.log(`[country-meta] response`, meta);
  await cacheSetJson("country-meta", key, meta, Math.floor(TTL_MS / 1000));
  return json(meta, { headers: { 'Cache-Control': 'private, max-age=3600', 'X-Cache': 'MISS' } });
};


