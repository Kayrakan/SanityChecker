import { getAdminClientByShop, adminGraphqlJson } from "./shopify-clients.server";

export async function getMarketCurrencyByCountry(shopDomain: string, countryCode: string): Promise<string | undefined> {
  const { admin } = await getAdminClientByShop(shopDomain);
  const needle = String(countryCode || '').toUpperCase();
  const json = await adminGraphqlJson<any>(admin, `
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
  const primary = (json?.data?.markets?.nodes ?? []).find((m: any) => m.primary);
  return primary?.currencySettings?.baseCurrency?.isoCode;
}

export async function isCountryEnabledInMarkets(shopDomain: string, countryCode: string): Promise<boolean> {
  const { admin } = await getAdminClientByShop(shopDomain);
  try {
    const needle = String(countryCode || '').toUpperCase();
    const json = await adminGraphqlJson<any>(admin, `
      #graphql
      query MarketByGeo($country: CountryCode!) {
        marketByGeography(countryCode: $country) { id }
      }
    `, { country: needle });
    return !!json?.data?.marketByGeography?.id;
  } catch (err: any) {
    console.error('isCountryEnabledInMarkets error', err?.message || err);
    return false;
  }
}

export async function getMarketCurrencyByCountryForAdmin(admin: { graphql: (q: string, v?: any) => Promise<Response> }, countryCode: string): Promise<string | undefined> {
  const needle = String(countryCode || '').toUpperCase();
  const json = await adminGraphqlJson<any>(admin as any, `
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
  const primary = (json?.data?.markets?.nodes ?? []).find((m: any) => m.primary);
  return primary?.currencySettings?.baseCurrency?.isoCode;
}

export async function isCountryEnabledInMarketsForAdmin(admin: { graphql: (q: string, v?: any) => Promise<Response> }, countryCode: string): Promise<boolean> {
  try {
    const needle = String(countryCode || '').toUpperCase();
    const json = await adminGraphqlJson<any>(admin as any, `
      #graphql
      query MarketByGeo($country: CountryCode!) {
        marketByGeography(countryCode: $country) { id }
      }
    `, { country: needle });
    return !!json?.data?.marketByGeography?.id;
  } catch (err: any) {
    console.error('isCountryEnabledInMarketsForAdmin error', err?.message || err);
    return false;
  }
}



