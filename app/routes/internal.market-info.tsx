import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getMarketCurrencyByCountryForAdmin, isCountryEnabledInMarketsForAdmin } from "../services/markets.server";
import { buildAdminLinks } from "../services/diagnostics-links.server";
import { getAdminClientByShop } from "../services/shopify-clients.server";
import { cacheGetJson, cacheSetJson } from "../services/cache.server";

// Simple in-memory cache per shop+country to avoid repeated Admin API calls during form edits
type CacheEntry = { ts: number; value: any };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('[internal.market-info] loader start');
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  const shopParam = String(url.searchParams.get("shop") || "");
  if (!countryCode) return json({});
  let shopDomain = shopParam;
  try {
    if (!shopDomain) {
      const { session } = await authenticate.admin(request);
      shopDomain = session.shop;
    }
  } catch {}
  console.log('[internal.market-info] shopDomain', shopDomain, 'countryCode', countryCode);
  if (!shopDomain) return json({});

  const key = `${shopDomain}|${countryCode.toUpperCase()}`;
  const cached = await cacheGetJson<any>("market-info", key);
  if (cached) {
    return json(cached, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Cache': 'HIT' } });
  }

  const { admin } = await getAdminClientByShop(shopDomain);
  const [currency, enabled] = await Promise.all([
    getMarketCurrencyByCountryForAdmin(admin as any, countryCode).catch(() => undefined),
    isCountryEnabledInMarketsForAdmin(admin as any, countryCode).catch(() => false),
  ]);
  const links = buildAdminLinks(shopDomain, {});
  const responseBody = { currency, enabled, marketsUrl: links.markets };
  try {
    console.log('[internal.market-info] response', JSON.stringify({ shopDomain, countryCode, response: responseBody }));
  } catch {}
  await cacheSetJson("market-info", key, responseBody, Math.floor(TTL_MS / 1000));
  return json(responseBody, { headers: { 'X-Debug-Route': 'internal.market-info', 'Cache-Control': 'private, max-age=300', 'X-Cache': 'MISS' } });
};


