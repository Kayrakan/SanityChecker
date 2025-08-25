import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getMarketCurrencyByCountry, isCountryEnabledInMarkets } from "../services/markets.server";
import { buildAdminLinks } from "../services/diagnostics-links.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({});
  const [currency, enabled] = await Promise.all([
    getMarketCurrencyByCountry(session.shop, countryCode).catch(() => undefined),
    isCountryEnabledInMarkets(session.shop, countryCode).catch(() => false),
  ]);
  const links = buildAdminLinks(session.shop, {});
  return json({ currency, enabled, marketsUrl: links.markets });
};


