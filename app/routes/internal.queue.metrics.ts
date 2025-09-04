import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { bullConnection } from "../services/queue-bull.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { Queue } = await import("bullmq");
  const queue = new Queue("jobs", { connection: bullConnection as any });
  const counts = await queue.getJobCounts(
    'waiting', 'active', 'completed', 'failed', 'delayed', 'paused'
  );
  return json({ counts });
};


