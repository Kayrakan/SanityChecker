import "@shopify/shopify-app-remix/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp, BillingInterval, } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BASIC_PLAN, PRO_PLAN, SCALE_PLAN } from "./billing/plans";
let cachedShopify = null;
function resolveAppUrl() {
    const raw = process.env.SHOPIFY_APP_URL || process.env.HOST || "";
    if (!raw) {
        return "";
    }
    try {
        const url = new URL(raw);
        const isAdminHost = url.hostname === "admin.shopify.com" ||
            url.hostname.endsWith(".admin.shopify.com");
        const isMyShopify = url.hostname.endsWith("myshopify.com");
        const inAdminPath = url.pathname.startsWith("/admin");
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
        return url.origin;
    }
    catch {
        return raw;
    }
}
function buildShopify() {
    const apiKey = process.env.SHOPIFY_API_KEY;
    if (!apiKey) {
        throw new Error("Missing required env var: SHOPIFY_API_KEY");
    }
    const apiSecretKey = process.env.SHOPIFY_API_SECRET;
    if (!apiSecretKey) {
        throw new Error("Missing required env var: SHOPIFY_API_SECRET");
    }
    const appUrl = resolveAppUrl();
    if (!appUrl) {
        throw new Error("Detected an empty appUrl configuration. Set SHOPIFY_APP_URL (or HOST) for the runtime environment.");
    }
    return shopifyApp({
        apiKey,
        apiSecretKey,
        apiVersion: ApiVersion.July25,
        scopes: process.env.SCOPES?.split(","),
        appUrl,
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
}
function getShopify() {
    if (!cachedShopify) {
        cachedShopify = buildShopify();
    }
    return cachedShopify;
}
function createLazyProxy(loader) {
    return new Proxy({}, {
        get(_target, prop, receiver) {
            const target = loader();
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function") {
                return value.bind(target);
            }
            return value;
        },
        has(_target, prop) {
            return Reflect.has(loader(), prop);
        },
        ownKeys() {
            return Reflect.ownKeys(loader());
        },
        getOwnPropertyDescriptor(_target, prop) {
            const descriptor = Object.getOwnPropertyDescriptor(loader(), prop);
            if (descriptor) {
                descriptor.configurable = true;
            }
            return descriptor;
        },
    });
}
const shopify = createLazyProxy(() => getShopify());
export default shopify;
export const apiVersion = ApiVersion.July25;
export function addDocumentResponseHeaders(...args) {
    return getShopify().addDocumentResponseHeaders(...args);
}
export const authenticate = createLazyProxy(() => getShopify().authenticate);
export const unauthenticated = createLazyProxy(() => getShopify().unauthenticated);
export function login(...args) {
    return getShopify().login(...args);
}
export function registerWebhooks(...args) {
    return getShopify().registerWebhooks(...args);
}
export const sessionStorage = createLazyProxy(() => getShopify().sessionStorage);
