import IORedis from "ioredis";
import { bullConnection } from "./queue-bull.server";

// Simple per-shop rate limiter using a fixed-window counter (1-second window).
// If Redis is not configured, falls back to in-memory window counters.
// Environment overrides:
//   RL_ADMIN_RPS (default 4)
//   RL_STOREFRONT_RPS (default 8)

const ADMIN_RPS = Number(process.env.RL_ADMIN_RPS || 4);
const STOREFRONT_RPS = Number(process.env.RL_STOREFRONT_RPS || 8);

let redis: IORedis | null = null;
try {
  // bullConnection may either be a url or a connection object
  const conn: any = (bullConnection as any);
  redis = new IORedis(conn.url || conn);
} catch {
  redis = null;
}

const memCounters = new Map<string, { ts: number; count: number }>();

function keyFor(type: "admin" | "storefront", shop: string) {
  const safeShop = String(shop || "").toLowerCase();
  return `rl:${type}:${safeShop}`;
}

function getLimitFor(type: "admin" | "storefront") {
  return type === "admin" ? ADMIN_RPS : STOREFRONT_RPS;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Consume 1 token from the bucket; if window is exhausted, wait until next second.
export async function consume(type: "admin" | "storefront", shop: string) {
  const limit = getLimitFor(type);
  if (limit <= 0) return;

  const now = Date.now();
  const winSec = Math.floor(now / 1000);
  const baseKey = keyFor(type, shop);

  if (redis) {
    const key = `${baseKey}:${winSec}`;
    const used = await (async () => {
      try {
        const v = await (redis as IORedis).incr(key);
        if (v === 1) {
          // Set expiry to the end of the second
          const ttl = 1000 - (now % 1000);
          await (redis as IORedis).pexpire(key, ttl);
        }
        return v;
      } catch {
        return Number.MAX_SAFE_INTEGER; // force fallback wait
      }
    })();
    if (used > limit) {
      const wait = 1000 - (now % 1000) + 5; // small buffer
      await sleep(wait);
    }
    return;
  }

  // In-memory fallback (per-process only)
  const mem = memCounters.get(baseKey);
  if (!mem || mem.ts !== winSec) {
    memCounters.set(baseKey, { ts: winSec, count: 1 });
    return;
  }
  if (mem.count < limit) {
    mem.count += 1;
    return;
  }
  const wait = 1000 - (now % 1000) + 5;
  await sleep(wait);
}

