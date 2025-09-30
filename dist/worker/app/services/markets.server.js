import { getAdminClientByShop, adminGraphqlJson } from "./shopify-clients.server.js";
export async function getMarketCurrencyByCountry(shopDomain, countryCode) {
    const { admin } = await getAdminClientByShop(shopDomain);
    const needle = String(countryCode || '').toUpperCase();
    const json = await adminGraphqlJson(admin, `
    #graphql
    query MarketInfo($country: CountryCode!) {
      marketByGeography(countryCode: $country) {
        id
        currencySettings { baseCurrency { isoCode } }
      }
      markets(first: 50) {
        nodes { id primary currencySettings { baseCurrency { isoCode } } }
      }
    }
  `, { country: needle });
    const market = json?.data?.marketByGeography;
    if (market?.currencySettings?.baseCurrency?.isoCode) {
        return market.currencySettings.baseCurrency.isoCode;
    }
    const primary = (json?.data?.markets?.nodes ?? []).find((m) => m.primary);
    return primary?.currencySettings?.baseCurrency?.isoCode;
}
export async function isCountryEnabledInMarkets(shopDomain, countryCode) {
    const { admin } = await getAdminClientByShop(shopDomain);
    try {
        const needle = String(countryCode || '').toUpperCase();
        const json = await adminGraphqlJson(admin, `
      #graphql
      query MarketByGeo($country: CountryCode!) {
        marketByGeography(countryCode: $country) { id }
      }
    `, { country: needle });
        return !!json?.data?.marketByGeography?.id;
    }
    catch (err) {
        console.error('isCountryEnabledInMarkets error', err?.message || err);
        return false;
    }
}
export async function getMarketCurrencyByCountryForAdmin(admin, countryCode) {
    const needle = String(countryCode || '').toUpperCase();
    const json = await adminGraphqlJson(admin, `
    #graphql
    query MarketInfo($country: CountryCode!) {
      marketByGeography(countryCode: $country) {
        id
        currencySettings { baseCurrency { isoCode } }
      }
      markets(first: 50) {
        nodes { id primary currencySettings { baseCurrency { isoCode } } }
      }
    }
  `, { country: needle });
    const market = json?.data?.marketByGeography;
    if (market?.currencySettings?.baseCurrency?.isoCode) {
        return market.currencySettings.baseCurrency.isoCode;
    }
    const primary = (json?.data?.markets?.nodes ?? []).find((m) => m.primary);
    return primary?.currencySettings?.baseCurrency?.isoCode;
}
export async function isCountryEnabledInMarketsForAdmin(admin, countryCode) {
    try {
        const needle = String(countryCode || '').toUpperCase();
        const json = await adminGraphqlJson(admin, `
      #graphql
      query MarketByGeo($country: CountryCode!) {
        marketByGeography(countryCode: $country) { id }
      }
    `, { country: needle });
        return !!json?.data?.marketByGeography?.id;
    }
    catch (err) {
        console.error('isCountryEnabledInMarketsForAdmin error', err?.message || err);
        return false;
    }
}
