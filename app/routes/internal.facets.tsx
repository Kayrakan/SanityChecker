import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { adminGraphqlJson, getAdminClientByShop } from "../services/shopify-clients.server";

// Returns vendors and product types suggestions for filters
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const qVendor = (url.searchParams.get("vendor") || "").trim();
  const qType = (url.searchParams.get("type") || "").trim();
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));
  const { admin } = await getAdminClientByShop(session.shop);

  // We query products with aggregations-like behavior by fetching unique vendors/types from first N products.
  const data = await adminGraphqlJson<any>(admin, `#graphql\nquery VendorsTypes($first:Int!){\n  products(first:$first, sortKey:TITLE){\n    edges{ node{ vendor productType } }\n  }\n}`, { first: 200 });
  const edges = data?.data?.products?.edges || [];
  const vendorsSet = new Set<string>();
  const typesSet = new Set<string>();
  for (const e of edges) {
    const v = (e?.node?.vendor || '').trim();
    const t = (e?.node?.productType || '').trim();
    if (v) vendorsSet.add(v);
    if (t) typesSet.add(t);
  }
  let vendors = Array.from(vendorsSet);
  let types = Array.from(typesSet);
  if (qVendor) vendors = vendors.filter(v => v.toLowerCase().includes(qVendor.toLowerCase()));
  if (qType) types = types.filter(t => t.toLowerCase().includes(qType.toLowerCase()));
  vendors = vendors.sort((a,b) => a.localeCompare(b)).slice(0, limit);
  types = types.sort((a,b) => a.localeCompare(b)).slice(0, limit);
  return json({ vendors, productTypes: types });
}

export default null;


