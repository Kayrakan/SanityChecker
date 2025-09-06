/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      R2_ACCOUNT_ID?: string;
      R2_ACCESS_KEY_ID?: string;
      R2_SECRET_ACCESS_KEY?: string;
      R2_BUCKET?: string;
      R2_PUBLIC_BASE_URL?: string; // e.g., https://cdn.example.com or https://<accountid>.r2.cloudflarestorage.com/<bucket>
      STOREFRONT_PASSWORD?: string; // Optional storefront password for dev/preview stores
      SCREENSHOT_CAPTURE_MODE?: string; // all | warn_fail_only | fail_only (default: warn_fail_only)
    }
  }
}

export {};
