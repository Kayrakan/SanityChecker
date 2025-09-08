import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { listShopifyProvinces } from "../services/countries.server";
import { cacheGetJson, cacheSetJson } from "../services/cache.server";

type CacheEntry = { ts: number; value: any };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({ provinces: [] });
  const key = `${session.shop}|${countryCode.toUpperCase()}`;
  const hit = await cacheGetJson<any>("provinces", key);
  if (hit) {
    return json(hit, { headers: { 'Cache-Control': 'private, max-age=1800', 'X-Cache': 'HIT' } });
  }
  const provinces = await listShopifyProvinces(session.shop, countryCode).catch(() => []);
  const value = { provinces };
  await cacheSetJson("provinces", key, value, Math.floor(TTL_MS / 1000));
  return json(value, { headers: { 'Cache-Control': 'private, max-age=1800', 'X-Cache': 'MISS' } });
};


