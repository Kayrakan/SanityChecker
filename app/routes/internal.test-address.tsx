import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getTestAddress } from "../services/test-addresses.server";

// unauthenticated helper used by the Scenario form
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const countryCode = String(url.searchParams.get("countryCode") || "");
  if (!countryCode) return json({});
  const addr = getTestAddress(countryCode);
  return json(addr);
};


