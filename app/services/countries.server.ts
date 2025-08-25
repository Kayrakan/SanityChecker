import { fetchAdminRest } from "./shopify-clients.server";

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
  let countryId = countryIdOrCode;
  if (typeof countryIdOrCode === "string" && countryIdOrCode.length === 2) {
    // If we received ISO-2 code, resolve to ID first
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


