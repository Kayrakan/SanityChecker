import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { lookupCityProvince } from "../services/address-lookup.server";
// deliberately unauthenticated; used client-side from the Scenario form

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  const postalCode = String(url.searchParams.get("postalCode") || "");
  if (!countryCode || !postalCode) return json({});
  const result = await lookupCityProvince(countryCode, postalCode);
  return json(result);
};


