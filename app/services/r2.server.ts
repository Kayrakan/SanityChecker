import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

function getEnv(name: string, optional = false): string | undefined {
  const v = process.env[name];
  if (!v && !optional) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const accountId = getEnv("R2_ACCOUNT_ID");
const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
const bucket = getEnv("R2_BUCKET");
const publicBase = getEnv("R2_PUBLIC_BASE_URL", true);

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

export const r2Client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: String(accessKeyId),
    secretAccessKey: String(secretAccessKey),
  },
});

export type UploadResult = { key: string; url: string };

export async function r2PutObject(opts: {
  key?: string;
  contentType: string;
  body: Buffer | Uint8Array | string;
  cacheControl?: string;
  aclPublic?: boolean; // R2 ignores ACL; we build URL either via publicBase or path-style
}): Promise<UploadResult> {
  const objectKey = opts.key || generateKey();
  await r2Client.send(
    new PutObjectCommand({
      Bucket: String(bucket),
      Key: objectKey,
      Body: opts.body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl || "public, max-age=31536000, immutable",
    })
  );
  const url = buildPublicUrl(objectKey);
  return { key: objectKey, url };
}

export function buildPublicUrl(key: string): string {
  if (publicBase) {
    const base = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
    return `${base}/${encodeURI(key)}`;
  }
  // default R2 public URL (requires public bucket or a domain via Cloudflare)
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURI(key)}`;
}

export function buildScreenshotKey(shopId: string, runId?: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const unique = runId || crypto.randomBytes(6).toString("hex");
  // Per-shop segregation to avoid cross-tenant confusion
  return `screenshots/${shopId}/${y}/${m}/${d}/${h}/${unique}.png`;
}

function generateKey(): string {
  // Legacy fallback (no shop context)
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const rand = crypto.randomBytes(6).toString("hex");
  return `screenshots/${y}/${m}/${d}/${h}/${rand}.png`;
}


