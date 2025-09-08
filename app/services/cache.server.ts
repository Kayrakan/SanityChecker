import IORedis from "ioredis";
import { bullConnection } from "./queue-bull.server";

type MemoryEntry = { expiresAt: number; value: any };
const memCache = new Map<string, MemoryEntry>();

function safeKey(namespace: string, key: string) {
  const ns = String(namespace || "").replace(/[^a-zA-Z0-9:_-]/g, ":");
  const k = String(key || "").replace(/\s+/g, "_");
  const composite = `${ns}:${k}`;
  // Redis max key length is large, but keep it sane
  return composite.length > 512 ? composite.slice(0, 512) : composite;
}

let redis: IORedis | null = null;
try {
  const conn: any = (bullConnection as any);
  redis = new IORedis(conn.url || conn);
} catch {
  redis = null;
}

export function isRedisAvailable() {
  return !!redis;
}

export async function cacheGetJson<T>(namespace: string, key: string): Promise<T | null> {
  const k = safeKey(namespace, key);
  if (redis) {
    try {
      const v = await (redis as IORedis).get(k);
      if (!v) return null;
      return JSON.parse(v) as T;
    } catch {
      // fall through to memory cache
    }
  }
  const e = memCache.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { memCache.delete(k); return null; }
  return e.value as T;
}

export async function cacheSetJson(namespace: string, key: string, value: any, ttlSeconds: number): Promise<void> {
  const k = safeKey(namespace, key);
  if (redis) {
    try {
      await (redis as IORedis).set(k, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
      return;
    } catch {
      // fall through to memory cache
    }
  }
  const ttlMs = Math.max(1000, ttlSeconds * 1000);
  memCache.set(k, { value, expiresAt: Date.now() + ttlMs });
}


