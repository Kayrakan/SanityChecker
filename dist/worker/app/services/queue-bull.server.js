import prisma from "../db.server.js";
// Central BullMQ queue for high-throughput background jobs
// Uses a single queue name "jobs" with typed job names.
function buildConnection() {
    const url = process.env.REDIS_URL;
    if (url) {
        // Upstash/Redis URL style
        return { url, maxRetriesPerRequest: null };
    }
    const host = process.env.REDIS_HOST || "127.0.0.1";
    const port = Number(process.env.REDIS_PORT || "6379");
    const password = process.env.REDIS_PASSWORD || undefined;
    const useTls = process.env.REDIS_TLS === "1";
    return {
        host,
        port,
        password,
        tls: useTls ? {} : undefined,
        maxRetriesPerRequest: null,
    };
}
export const bullConnection = buildConnection();
// Create queue lazily so server can boot without Redis/BullMQ installed
let queuePromise = null;
async function getQueue() {
    if (!queuePromise) {
        queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue("jobs", { connection: bullConnection });
        })();
    }
    return queuePromise;
}
// Enqueue a scenario run using BullMQ.
// Creates a Run row first for idempotency, then enqueues with runId.
export async function enqueueScenarioRunBull(shopId, scenarioId, opts) {
    // Create pending run record now so retries/dedup won't create duplicates
    const run = await prisma.run.create({ data: { scenarioId, shopId } });
    const q = await getQueue();
    await q.add("SCENARIO_RUN", { shopId, scenarioId, runId: run.id }, {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        ...(opts || {}),
    });
    return run;
}
// Optional: enqueue digest email via BullMQ (not yet wired).
export async function enqueueDigestEmailBull(shopId, opts) {
    const q = await getQueue();
    await q.add("DIGEST_EMAIL", { shopId }, {
        attempts: 3,
        backoff: { type: "fixed", delay: 60_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        ...(opts || {}),
    });
}
