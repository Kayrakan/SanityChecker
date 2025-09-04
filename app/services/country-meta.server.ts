import IORedis from "ioredis";
import { bullConnection } from "./queue-bull.server";
import { listShopifyProvinces, getShopifyCountryRequirements, type Province } from "./countries.server";
// We call Shopify's public address metadata GraphQL directly (no deprecated deps)
const GRAPHQL_ENDPOINT = 'https://atlas.shopifysvc.com/graphql';
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } as const;
const ADDRESS_QUERY = `
query country($countryCode: SupportedCountry!, $locale: SupportedLocale!) {
  country(countryCode: $countryCode, locale: $locale) {
    name
    code
    labels { address1 address2 city company country firstName lastName phone postalCode zone }
    formatting { edit show }
  }
}
`;

export type CountryMeta = {
  requiresPostal: boolean; // from Admin API (zipRequired)
  requiresProvince: boolean; // from Admin API (provinceRequired)
  provinces: Province[]; // from Admin API (GraphQL preferred)
  labels: Record<string, string>; // from public address metadata
  orderedFields: string[][]; // from public address metadata formatting.edit
  required: Record<string, boolean>; // only keys Shopify explicitly requires (postalCode, provinceCode)
  provinceLabel?: string;
  cityLabel?: string;
};

// TTL defaults to 24 hours
const DEFAULT_TTL_MS = Number(process.env.COUNTRY_META_TTL_MS || 24 * 60 * 60 * 1000);

let redis: IORedis | null = null;
try {
  const conn: any = (bullConnection as any);
  redis = new IORedis(conn.url || conn);
} catch {
  redis = null;
}

type CacheEntry = { expiresAt: number; data: CountryMeta };
const memCache = new Map<string, CacheEntry>();

function keyFor(shop: string, countryCode: string) {
  return `country-meta:${String(shop || "").toLowerCase()}:${String(countryCode || "").toUpperCase()}`;
}

// We avoid hard-coded optional/required rules; follow Shopify metadata only.

export async function getCountryMeta(shopDomain: string, countryCode: string): Promise<CountryMeta> {
  const key = keyFor(shopDomain, countryCode);
  const now = Date.now();

  const cached = memCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const locale = "en";
  const resp = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query: ADDRESS_QUERY, variables: { countryCode: String(countryCode).toUpperCase(), locale: locale.replace(/-/, '_').toUpperCase() }, operationName: 'country' })
  });
  const json = await resp.json();
  const country = json?.data?.country || {};

  const editLayout: string = String(country?.formatting?.edit || '').trim();
  const groups = editLayout ? editLayout.split('_') : [];
  const FIELD_MAP: Record<string, string> = {
    '{firstName}': 'firstName', '{lastName}': 'lastName', '{company}': 'company', '{address1}': 'address1', '{address2}': 'address2', '{city}': 'city', '{country}': 'countryCode', '{province}': 'provinceCode', '{zip}': 'postalCode', '{phone}': 'phone'
  };
  const orderedFields: string[][] = groups
    .map((g: string) => (g.match(/({\w+})/g) || []).map((m: string) => FIELD_MAP[m]).filter(Boolean))
    .filter((arr: string[]) => arr.length > 0);

  const labels = {
    address1: country?.labels?.address1,
    address2: country?.labels?.address2,
    city: country?.labels?.city,
    company: country?.labels?.company,
    countryCode: country?.labels?.country,
    firstName: country?.labels?.firstName,
    lastName: country?.labels?.lastName,
    phone: country?.labels?.phone,
    postalCode: country?.labels?.postalCode,
    provinceCode: country?.labels?.zone,
  } as Record<string, string>;

  const provinces = await listShopifyProvinces(shopDomain, countryCode).catch(() => []);
  const adminReq = await getShopifyCountryRequirements(shopDomain, countryCode).catch(() => ({ zipRequired: false, provinceRequired: false }));
  console.log("adminReq");
  console.log(adminReq);
  const required: Record<string, boolean> = {
    firstName: false,
    lastName: false,
    company: false,
    address1: false,
    address2: false,
    city: false,
    provinceCode: !!adminReq.provinceRequired,
    postalCode: !!adminReq.zipRequired,
    phone: false,
    countryCode: false,
  };
  console.log("required");
  console.log(required);

  const data: CountryMeta = {
    requiresPostal: !!adminReq.zipRequired,
    requiresProvince: !!adminReq.provinceRequired,
    provinces,
    labels,
    orderedFields,
    required,
    provinceLabel: labels.provinceCode,
    cityLabel: labels.city,
  };
  console.log("country meta data");
  console.log(data);
  const entry: CacheEntry = { expiresAt: now + DEFAULT_TTL_MS, data };
  memCache.set(key, entry);
  return data;
}


