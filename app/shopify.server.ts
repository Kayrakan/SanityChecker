import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const BASIC_PLAN = "basic" as const;
export const PRO_PLAN = "pro" as const;
export const SCALE_PLAN = "scale" as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
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
