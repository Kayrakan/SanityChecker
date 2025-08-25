type LookupResult = { city?: string; provinceCode?: string };

async function lookupViaZippopotam(countryCode: string, postalCode: string): Promise<LookupResult> {
  const cc = countryCode.toLowerCase();
  try {
    const res = await fetch(`https://api.zippopotam.us/${cc}/${encodeURIComponent(postalCode)}`);
    if (!res.ok) return {};
    const json = await res.json();
    const place = Array.isArray(json?.places) ? json.places[0] : undefined;
    const city = place?.["place name"] || place?.["state"] || undefined;
    const provinceCode = place?.["state abbreviation"] || undefined;
    return { city, provinceCode };
  } catch {
    return {};
  }
}

async function lookupViaGoogleGeocoding(countryCode: string, postalCode: string): Promise<LookupResult> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) return {};
  const params = new URLSearchParams({ address: postalCode, components: `country:${countryCode}` });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = await res.json();
    const result = Array.isArray(json?.results) ? json.results[0] : undefined;
    if (!result) return {};
    const components: any[] = result.address_components || [];
    const locality = components.find(c => c.types.includes("locality"))?.short_name || components.find(c => c.types.includes("postal_town"))?.short_name;
    const admin1 = components.find(c => c.types.includes("administrative_area_level_1"))?.short_name;
    return { city: locality, provinceCode: admin1 };
  } catch {
    return {};
  }
}

export async function lookupCityProvince(countryCode: string, postalCode: string): Promise<LookupResult> {
  if (!countryCode || !postalCode) return {};
  // Try Google first for richer data, then fallback to Zippopotam
  const google = await lookupViaGoogleGeocoding(countryCode, postalCode);
  if (google.city || google.provinceCode) return google;
  const zippo = await lookupViaZippopotam(countryCode, postalCode);
  return zippo;
}


