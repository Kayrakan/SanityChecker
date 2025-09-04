import { fetchAdminRest, getAdminClientByShop, adminGraphqlJson } from "./shopify-clients.server";
// Default to Admin GraphQL for country/province metadata; REST endpoints are deprecated in many shops.
const PREFER_ADMIN_GRAPHQL_COUNTRIES = String((process.env as any).PREFER_ADMIN_GRAPHQL_COUNTRIES ?? '1').trim() === '1';

export type CountryOption = { label: string; value: string; id: number };
export type Province = { code: string; name: string };

export async function listShopifyCountries(shopDomain: string): Promise<CountryOption[]> {
  // Admin REST: GET /admin/api/<ver>/countries.json
  const res = await fetchAdminRest(shopDomain, "/countries.json");
  if (!res.ok) return [];
  const json = await res.json();
  const countries = Array.isArray(json?.countries) ? json.countries : [];
  return countries.map((c: any) => ({ label: c.name, value: c.code, id: c.id }));
}

export async function listShopifyProvinces(shopDomain: string, countryIdOrCode: string | number): Promise<Province[]> {
  // Try Admin GraphQL first when we have a 2-letter country code
  if (PREFER_ADMIN_GRAPHQL_COUNTRIES) {
    try {
      if (typeof countryIdOrCode === "string" && countryIdOrCode.length === 2) {
        const { admin } = await getAdminClientByShop(shopDomain);
        const data = await adminGraphqlJson<any>(admin, `#graphql
          query CountryProvinces($code: CountryCode!) {
            countryByCode(code: $code) { provinces: subdivisions(first: 250) { nodes { code name } } }
          }
        `, { code: String(countryIdOrCode).toUpperCase() });
        const nodes = data?.data?.countryByCode?.provinces?.nodes || [];
        if (Array.isArray(nodes) && nodes.length > 0) {
          return nodes.map((n: any) => ({ code: n?.code, name: n?.name })).filter((p: Province) => !!p.code && !!p.name);
        }
      }
    } catch (err: any) {
      console.warn("[countries.server] Admin GraphQL provinces unsupported; falling back to REST", err?.message || err);
    }
  }

  // Fallback to Admin REST
  let countryId = countryIdOrCode;
  if (typeof countryIdOrCode === "string" && countryIdOrCode.length === 2) {
    const countries = await listShopifyCountries(shopDomain);
    const match = countries.find(c => c.value.toUpperCase() === countryIdOrCode.toUpperCase());
    if (!match) return [];
    countryId = match.id;
  }
  const res = await fetchAdminRest(shopDomain, `/countries/${countryId}.json`);
  if (!res.ok) return [];
  const json = await res.json();
  const provinces = json?.country?.provinces ?? [];
  return provinces.map((p: any) => ({ code: p.code, name: p.name }));
}

export async function getShopifyCountryRequirements(shopDomain: string, countryIdOrCode: string | number): Promise<{ zipRequired: boolean; provinceRequired: boolean }> {
  // Prefer Admin GraphQL if available
  if (PREFER_ADMIN_GRAPHQL_COUNTRIES) {
    try {
      if (typeof countryIdOrCode === "string" && countryIdOrCode.length === 2) {
        const { admin } = await getAdminClientByShop(shopDomain);
        const data = await adminGraphqlJson<any>(admin, `#graphql
          query CountryRequirements($code: CountryCode!) {
            countryByCode(code: $code) { code zipRequired provinceRequired }
          }
        `, { code: String(countryIdOrCode).toUpperCase() });
        const node = data?.data?.countryByCode;
        if (node && (typeof node.zipRequired === 'boolean' || typeof node.provinceRequired === 'boolean')) {
          return { zipRequired: !!node.zipRequired, provinceRequired: !!node.provinceRequired };
        }
      }
    } catch (err: any) {
      console.warn("[countries.server] Admin GraphQL requirements unsupported; falling back to REST", err?.message || err);
    }
  }

  // Fallback to Admin REST
  let countryId = countryIdOrCode;
  if (typeof countryIdOrCode === "string" && countryIdOrCode.length === 2) {
    const countries = await listShopifyCountries(shopDomain);
    const match = countries.find(c => c.value.toUpperCase() === countryIdOrCode.toUpperCase());
    if (!match) return { zipRequired: false, provinceRequired: false };
    countryId = match.id;
  }
  const res = await fetchAdminRest(shopDomain, `/countries/${countryId}.json`);
  console.log("res");
  console.log(res);
  if (!res.ok) return { zipRequired: false, provinceRequired: false };
  const json = await res.json();
  console.log("json");
  console.log(json);
  const c = json?.country || {};
  console.log("c");
  console.log(c);
  // First attempt: flags on the single-country payload
  let zipRequired: boolean | undefined = (c as any).zip_required;
  let provinceRequired: boolean | undefined = (c as any).province_required;
  // If flags are missing, try countries index as a secondary source
  if (typeof zipRequired !== 'boolean' || typeof provinceRequired !== 'boolean') {
    try {
      const listRes = await fetchAdminRest(shopDomain, "/countries.json");
      if (listRes.ok) {
        const listJson = await listRes.json();
        const items: any[] = Array.isArray(listJson?.countries) ? listJson.countries : [];
        const match = items.find((it) => String(it?.id || '') === String((c as any)?.id || countryId) || String(it?.code || '').toUpperCase() === (typeof countryIdOrCode === 'string' ? countryIdOrCode.toUpperCase() : '')) || {};
        if (typeof match?.zip_required === 'boolean') zipRequired = match.zip_required;
        if (typeof match?.province_required === 'boolean') provinceRequired = match.province_required;
      }
    } catch {}
  }
  return { zipRequired: !!zipRequired, provinceRequired: !!provinceRequired };
}


