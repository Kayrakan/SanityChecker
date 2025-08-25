import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { listShopifyProvinces } from "../services/countries.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({ provinces: [] });
  const provinces = await listShopifyProvinces(session.shop, countryCode).catch(() => []);
  return json({ provinces });
};


