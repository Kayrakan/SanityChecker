import IORedis from "ioredis";
import { bullConnection } from "./queue-bull.server";
const memCache = new Map();
function safeKey(namespace, key) {
    const ns = String(namespace || "").replace(/[^a-zA-Z0-9:_-]/g, ":");
    const k = String(key || "").replace(/\s+/g, "_");
    const composite = `${ns}:${k}`;
    // Redis max key length is large, but keep it sane
    return composite.length > 512 ? composite.slice(0, 512) : composite;
}
let redis = null;
try {
    const conn = bullConnection;
    redis = new IORedis(conn.url || conn);
}
catch {
    redis = null;
}
export function isRedisAvailable() {
    return !!redis;
}
export async function cacheGetJson(namespace, key) {
    const k = safeKey(namespace, key);
    if (redis) {
        try {
            const v = await redis.get(k);
            if (!v)
                return null;
            return JSON.parse(v);
        }
        catch {
            // fall through to memory cache
        }
    }
    const e = memCache.get(k);
    if (!e)
        return null;
    if (e.expiresAt < Date.now()) {
        memCache.delete(k);
        return null;
    }
    return e.value;
}
export async function cacheSetJson(namespace, key, value, ttlSeconds) {
    const k = safeKey(namespace, key);
    if (redis) {
        try {
            await redis.set(k, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
            return;
        }
        catch {
            // fall through to memory cache
        }
    }
    const ttlMs = Math.max(1000, ttlSeconds * 1000);
    memCache.set(k, { value, expiresAt: Date.now() + ttlMs });
}
