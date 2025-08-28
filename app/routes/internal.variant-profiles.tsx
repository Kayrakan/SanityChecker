import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { fetchDeliveryProfilesForVariants } from "../services/profiles.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ids = (url.searchParams.getAll("id") || []).flatMap((v) => v.split(","));
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const names = await fetchDeliveryProfilesForVariants(session.shop, uniq);
  const map: Record<string, string> = {};
  for (let i = 0; i < uniq.length; i++) map[uniq[i]] = names[i] || "";
  return json({ profiles: map });
}

export default null;


