import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCountryMeta } from "../services/country-meta.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({});
  console.log(`[country-meta] request`, { shop: session.shop, countryCode });
  const meta = await getCountryMeta(session.shop, countryCode);
  console.log(`[country-meta] response`, meta);
  return json(meta);
};


