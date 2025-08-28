import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { adminGraphqlJson, getAdminClientByShop } from "../services/shopify-clients.server";

// Simple in-memory cache for suggestions
const TTL_MS = 60_000;
let lastQ = "";
let lastAt = 0;
let lastRes: any = null;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));

  if (q === lastQ && Date.now() - lastAt < TTL_MS && lastRes) {
    return json(lastRes);
  }

  const { admin } = await getAdminClientByShop(session.shop);
  const query = q ? `title:*${q.replace(/\"/g, '\\"')}*` : undefined;
  const data = await adminGraphqlJson<any>(admin, `#graphql\nquery Collections($first:Int!,$after:String,$query:String){\n  collections(first:$first, after:$after, query:$query, sortKey:TITLE){\n    edges{ node{ id title } }\n    pageInfo{ hasNextPage endCursor }\n  }\n}`, { first: limit, after: undefined, query });
  const edges = data?.data?.collections?.edges || [];
  const options = edges.map((e: any) => ({ value: e?.node?.id, label: e?.node?.title })).filter((o: any) => o.value && o.label);
  const payload = { options };
  lastQ = q; lastAt = Date.now(); lastRes = payload;
  return json(payload);
}

export default null;


