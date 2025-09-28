import IORedis from "ioredis";
import { bullConnection } from "./queue-bull.server";
import { listShopifyProvinces, getShopifyCountryRequirements } from "./countries.server";
// We call Shopify's public address metadata GraphQL directly (no deprecated deps)
const GRAPHQL_ENDPOINT = 'https://atlas.shopifysvc.com/graphql';
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
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
// TTL defaults to 24 hours
const DEFAULT_TTL_MS = Number(process.env.COUNTRY_META_TTL_MS || 24 * 60 * 60 * 1000);
let redis = null;
try {
    const conn = bullConnection;
    redis = new IORedis(conn.url || conn);
}
catch {
    redis = null;
}
const memCache = new Map();
function keyFor(shop, countryCode) {
    return `country-meta:${String(shop || "").toLowerCase()}:${String(countryCode || "").toUpperCase()}`;
}
// We avoid hard-coded optional/required rules; follow Shopify metadata only.
export async function getCountryMeta(shopDomain, countryCode) {
    const key = keyFor(shopDomain, countryCode);
    const now = Date.now();
    const cached = memCache.get(key);
    if (cached && cached.expiresAt > now)
        return cached.data;
    const locale = "en";
    const resp = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ query: ADDRESS_QUERY, variables: { countryCode: String(countryCode).toUpperCase(), locale: locale.replace(/-/, '_').toUpperCase() }, operationName: 'country' })
    });
    const json = await resp.json();
    const country = json?.data?.country || {};
    const editLayout = String(country?.formatting?.edit || '').trim();
    const groups = editLayout ? editLayout.split('_') : [];
    const FIELD_MAP = {
        '{firstName}': 'firstName', '{lastName}': 'lastName', '{company}': 'company', '{address1}': 'address1', '{address2}': 'address2', '{city}': 'city', '{country}': 'countryCode', '{province}': 'provinceCode', '{zip}': 'postalCode', '{phone}': 'phone'
    };
    const orderedFields = groups
        .map((g) => (g.match(/({\w+})/g) || []).map((m) => FIELD_MAP[m]).filter(Boolean))
        .filter((arr) => arr.length > 0);
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
    };
    const provinces = await listShopifyProvinces(shopDomain, countryCode).catch(() => []);
    const adminReq = await getShopifyCountryRequirements(shopDomain, countryCode).catch(() => ({ zipRequired: false, provinceRequired: false }));
    console.log("adminReq");
    console.log(adminReq);
    const required = {
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
    const data = {
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
    const entry = { expiresAt: now + DEFAULT_TTL_MS, data };
    memCache.set(key, entry);
    return data;
}
