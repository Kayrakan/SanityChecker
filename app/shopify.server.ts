import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BASIC_PLAN, PRO_PLAN, SCALE_PLAN } from "./billing/plans";

const APP_URL = (() => {
  const raw = process.env.SHOPIFY_APP_URL || process.env.HOST || "";
  try {
    const u = new URL(raw);
    const isAdminHost = u.hostname === "admin.shopify.com" || u.hostname.endsWith(".admin.shopify.com");
    const isMyShopify = u.hostname.endsWith("myshopify.com");
    const inAdminPath = u.pathname.startsWith("/admin");
    if (isAdminHost || isMyShopify || inAdminPath) {
      const fallback = process.env.HOST || "";
      if (fallback && fallback !== raw) {
        // eslint-disable-next-line no-console
        console.warn("[config] Ignoring invalid SHOPIFY_APP_URL (points to Shopify Admin/storefront). Falling back to HOST.", { raw, fallback });
        return fallback;
      }
      // eslint-disable-next-line no-console
      console.warn("[config] Invalid SHOPIFY_APP_URL and no HOST fallback. Billing/auth may fail.", { raw });
      return "";
    }
    return u.origin;
  } catch {
    return raw;
  }
})();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BASIC_PLAN]: {
      trialDays: 7,
      lineItems: [
        { amount: 29, currencyCode: "USD", interval: BillingInterval.Every30Days },
      ],
    },
    [PRO_PLAN]: {
      trialDays: 7,
      lineItems: [
        { amount: 59, currencyCode: "USD", interval: BillingInterval.Every30Days },
      ],
    },
    [SCALE_PLAN]: {
      trialDays: 7,
      lineItems: [
        { amount: 99, currencyCode: "USD", interval: BillingInterval.Every30Days },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
