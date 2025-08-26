import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getMarketCurrencyByCountryForAdmin, isCountryEnabledInMarketsForAdmin } from "../services/markets.server";
import { buildAdminLinks } from "../services/diagnostics-links.server";
import { getAdminClientByShop } from "../services/shopify-clients.server";

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
  return json(responseBody, { headers: { 'X-Debug-Route': 'internal.market-info' } });
};


