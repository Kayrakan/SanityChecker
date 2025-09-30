import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}
let cachedConfig = null;
function getConfig() {
    if (!cachedConfig) {
        cachedConfig = {
            accountId: requireEnv("R2_ACCOUNT_ID"),
            accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
            bucket: requireEnv("R2_BUCKET"),
            publicBase: process.env.R2_PUBLIC_BASE_URL,
        };
    }
    return cachedConfig;
}
let cachedClient = null;
function getClient() {
    if (!cachedClient) {
        const { accountId, accessKeyId, secretAccessKey } = getConfig();
        cachedClient = new S3Client({
            region: "auto",
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }
    return cachedClient;
}
export const r2Client = new Proxy({}, {
    get(_target, prop, receiver) {
        const client = getClient();
        const value = Reflect.get(client, prop, receiver);
        if (typeof value === "function") {
            return value.bind(client);
        }
        return value;
    },
});
export async function r2PutObject(opts) {
    const objectKey = opts.key || generateKey();
    const { bucket } = getConfig();
    await getClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: opts.body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl || "public, max-age=31536000, immutable",
    }));
    const url = buildPublicUrl(objectKey);
    return { key: objectKey, url };
}
export function buildPublicUrl(key) {
    const { accountId, bucket, publicBase } = getConfig();
    if (publicBase) {
        const base = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
        return `${base}/${encodeURI(key)}`;
    }
    // default R2 public URL (requires public bucket or a domain via Cloudflare)
    return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURI(key)}`;
}
export function buildScreenshotKey(shopId, runId) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const h = String(now.getUTCHours()).padStart(2, "0");
    const unique = runId || crypto.randomBytes(6).toString("hex");
    // Per-shop segregation to avoid cross-tenant confusion
    return `screenshots/${shopId}/${y}/${m}/${d}/${h}/${unique}.png`;
}
function generateKey() {
    // Legacy fallback (no shop context)
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const h = String(now.getUTCHours()).padStart(2, "0");
    const rand = crypto.randomBytes(6).toString("hex");
    return `screenshots/${y}/${m}/${d}/${h}/${rand}.png`;
}
