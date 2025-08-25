import { getAdminClientByShop } from "./shopify-clients.server";

export async function getMarketCurrencyByCountry(shopDomain: string, countryCode: string): Promise<string | undefined> {
  const { admin } = await getAdminClientByShop(shopDomain);
  const res = await admin.graphql(`
    #graphql
    query MarketsAll {
      markets(first: 50) {
        nodes {
          id
          primary
          status
          regions(first: 250) { nodes { countryCode } }
          currencySettings { baseCurrency { isoCode } }
        }
      }
    }
  `, {});
  const json = await res.json();
  const markets: any[] = json?.data?.markets?.nodes ?? [];
  const needle = String(countryCode || '').toUpperCase();
  for (const m of markets) {
    const regionCodes: string[] = ((m.regions?.nodes ?? []) as any[]).map((r: any) => String(r.countryCode || '').toUpperCase());
    if (regionCodes.includes(needle)) {
      return m.currencySettings?.baseCurrency?.isoCode;
    }
  }
  const primary = markets.find((m: any) => m.primary);
  return primary?.currencySettings?.baseCurrency?.isoCode;
}

export async function isCountryEnabledInMarkets(shopDomain: string, countryCode: string): Promise<boolean> {
  const { admin } = await getAdminClientByShop(shopDomain);
  const res = await admin.graphql(`
    #graphql
    query MarketsAll {
      markets(first: 50) {
        nodes {
          id
          status
          regions(first: 250) { nodes { countryCode } }
        }
      }
    }
  `, {});
  const json = await res.json();
  const markets: any[] = json?.data?.markets?.nodes ?? [];
  const needle = String(countryCode || '').toUpperCase();
  return markets.some((m: any) => String(m.status) === 'ACTIVE' && ((m.regions?.nodes ?? []) as any[]).some((r: any) => String(r.countryCode || '').toUpperCase() === needle));
}

export async function getMarketCurrencyByCountryForAdmin(admin: { graphql: (q: string, v?: any) => Promise<Response> }, countryCode: string): Promise<string | undefined> {
  const res = await admin.graphql(`
    #graphql
    query MarketsAll {
      markets(first: 50) {
        nodes {
          id
          primary
          regions(first: 250) { nodes { countryCode } }
          currencySettings { baseCurrency { isoCode } }
        }
      }
    }
  `, {});
  const json = await res.json();
  const markets: any[] = json?.data?.markets?.nodes ?? [];
  const needle = String(countryCode || '').toUpperCase();
  for (const m of markets) {
    const regionCodes: string[] = ((m.regions?.nodes ?? []) as any[]).map((r: any) => String(r.countryCode || '').toUpperCase());
    if (regionCodes.includes(needle)) {
      return m.currencySettings?.baseCurrency?.isoCode;
    }
  }
  const primary = markets.find((m: any) => m.primary);
  return primary?.currencySettings?.baseCurrency?.isoCode;
}

export async function isCountryEnabledInMarketsForAdmin(admin: { graphql: (q: string, v?: any) => Promise<Response> }, countryCode: string): Promise<boolean> {
  const res = await admin.graphql(`
    #graphql
    query MarketsAll {
      markets(first: 50) {
        nodes {
          id
          status
          regions(first: 250) { nodes { countryCode } }
        }
      }
    }
  `, {});
  const json = await res.json();
  const markets: any[] = json?.data?.markets?.nodes ?? [];
  const needle = String(countryCode || '').toUpperCase();
  return markets.some((m: any) => String(m.status) === 'ACTIVE' && ((m.regions?.nodes ?? []) as any[]).some((r: any) => String(r.countryCode || '').toUpperCase() === needle));
}


