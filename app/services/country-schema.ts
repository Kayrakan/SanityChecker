// Deprecated: Replaced by dynamic Shopify Admin REST-backed services in countries.server.ts
export type Subdivision = { code: string; name: string };
export type CountrySchema = {
  code: string;
  name: string;
  requiresPostal: boolean;
  requiresProvince: boolean;
  requiresCity: boolean;
  provinceLabel?: string;
  cityLabel?: string;
  subdivisions?: Subdivision[];
};

export function listCountries(): { label: string; value: string }[] { return []; }
export function getCountrySchema(_code: string): CountrySchema | undefined { return undefined; }
export function getSubdivisions(_code: string): Subdivision[] { return []; }
export function listCountrySchemas(): CountrySchema[] { return []; }
