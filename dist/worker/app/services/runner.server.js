import prisma from "../db.server.js";
import { unauthenticatedStorefrontClient } from "./shopify-clients.server.js";
import { ensureStorefrontToken, rotateStorefrontToken } from "./storefront-token.server.js";
import { createRun, completeRun } from "../models/run.server.js";
import { buildAdminLinks } from "./diagnostics-links.server.js";
import { lookupCityProvince } from "./address-lookup.server.js";
import { getShopifyCountryRequirements } from "./countries.server.js";
import { isCountryEnabledInMarkets } from "./markets.server.js";
import { fetchVariantInfos } from "./variants.server.js";
import { listShopifyProvinces } from "./countries.server.js";
import { captureCheckoutScreenshot } from "./screenshot.server.js";
import { r2PutObject, buildScreenshotKey } from "./r2.server.js";
function buildDiagnostics(groups, options, subtotal, expectations) {
    const diags = [];
    function diagnoseNoRates() {
        const anyGroupEmpty = (groups ?? []).some((g) => (g.deliveryOptions ?? []).length === 0);
        if (!options || (options.length === 0) || anyGroupEmpty) {
            diags.push({
                code: "NO_RATES",
                message: "No shipping options returned.",
                probableCauses: [
                    "Destination not included in any shipping zone",
                    "Product weight missing or product not marked as physical",
                    "Market not active or shipping disabled",
                    "Mixed-profile cart without compatible merged rates",
                    "Carrier outage or timeout",
                ],
            });
        }
    }
    function diagnoseExpectationsFree() {
        if (!(expectations?.freeShippingThreshold != null && options && options.length > 0))
            return;
        const hasFree = options.some(o => Number(o.estimatedCost.amount) === 0);
        if (!hasFree) {
            diags.push({ code: "FREE_SHIPPING_MISSING", message: `Expected free shipping >= ${expectations.freeShippingThreshold}` });
        }
        if (subtotal) {
            const subtotalNum = Number(subtotal.amount);
            if (subtotalNum < Number(expectations.freeShippingThreshold)) {
                diags.push({ code: "SUBTOTAL_BELOW_THRESHOLD", message: `Cart subtotal ${subtotal.amount} < threshold ${expectations.freeShippingThreshold}` });
            }
        }
        if (expectations.currency && subtotal && expectations.currency !== subtotal.currencyCode) {
            diags.push({ code: "CURRENCY_MISMATCH", message: `Scenario currency ${expectations.currency} vs subtotal currency ${subtotal.currencyCode}` });
        }
    }
    function diagnoseBounds() {
        if (!(expectations?.min != null || expectations?.max != null))
            return;
        const opts = (options ?? []);
        let targetOptions = opts;
        const target = (expectations?.boundsTarget || 'CHEAPEST');
        if (target === 'TITLE') {
            const needle = String(expectations?.boundsTitle || '').toLowerCase();
            targetOptions = opts.filter(o => o.title?.toLowerCase().includes(needle));
            if (needle && targetOptions.length === 0) {
                diags.push({ code: "TARGET_RATE_NOT_FOUND", message: `No rate with title containing "${expectations.boundsTitle}"` });
            }
        }
        let prices = targetOptions.map(o => Number(o.estimatedCost.amount));
        if (target === 'CHEAPEST' && prices.length > 0) {
            const cheapest = Math.min(...prices);
            prices = [cheapest];
        }
        if (expectations.min != null && prices.some(p => p < expectations.min)) {
            diags.push({ code: "PRICE_TOO_LOW", message: `Target rate below ${expectations.min}` });
        }
        if (expectations.max != null && prices.some(p => p > expectations.max)) {
            diags.push({ code: "PRICE_TOO_HIGH", message: `Target rate above ${expectations.max}` });
        }
    }
    diagnoseNoRates();
    diagnoseExpectationsFree();
    diagnoseBounds();
    return diags;
}
export async function runScenarioById(scenarioId, runId) {
    console.log("running scenario", scenarioId, runId);
    const db = prisma;
    const scenario = await db.scenario.findUnique({ where: { id: scenarioId }, include: { shop: { include: { settings: true } } } });
    if (!scenario)
        throw new Error("Scenario not found");
    const { shop } = scenario;
    // Ensure we have a Run row to write results into. Prefer the provided runId.
    // This avoids creating a second Run when we hit early-return paths (e.g., empty cart).
    let run = runId ? await db.run.findUnique({ where: { id: runId } }) : null;
    if (!run) {
        run = await createRun(scenario.id, shop.id);
    }
    // Build cart
    const lines = scenario.productVariantIds.map((variantId, idx) => ({
        merchandiseId: variantId,
        quantity: scenario.quantities[idx] ?? 1,
    }));
    // If the scenario has no items, we cannot get shipping rates. Fail fast with a clear diagnostic.
    if (!Array.isArray(lines) || lines.length === 0) {
        const diag = [
            { code: "EMPTY_CART", message: "Scenario has no items. Add at least one physical product with weight > 0." },
            { code: "ADMIN_LINKS", links: buildAdminLinks(shop.domain, {}) },
        ];
        await completeRun(run.id, "FAIL", { groups: [], options: [], subtotal: null }, diag);
        return await db.run.findUnique({ where: { id: run.id } });
    }
    // Run row already ensured above
    try {
        function extractGroupsFromCart(cart) {
            const dg = cart?.deliveryGroups;
            if (!dg)
                return [];
            if (Array.isArray(dg))
                return dg;
            if (Array.isArray(dg.nodes))
                return dg.nodes;
            if (Array.isArray(dg.edges))
                return dg.edges.map((e) => e?.node).filter(Boolean);
            return [];
        }
        // Ensure a Storefront token exists (provision via Admin API if needed)
        console.log("ensuring storefront token", shop.domain);
        const ensured = await ensureStorefrontToken(shop.domain);
        console.log("ensured", ensured);
        let token = ensured.token;
        console.log("storefront token", token);
        let version = ensured.version;
        let client = await unauthenticatedStorefrontClient(shop.domain, token, version);
        // Preflight: resolve variant infos to confirm visibility and shippability
        let preflightVariantInfos = [];
        try {
            preflightVariantInfos = await fetchVariantInfos(shop.domain, Array.isArray(scenario.productVariantIds) ? scenario.productVariantIds : []);
        }
        catch { }
        console.log("client", client);
        const cartCreateRes = await client.graphql(`#graphql
      mutation CreateCart($lines: [CartLineInput!]!, $buyerIdentity: CartBuyerIdentityInput) {
        cartCreate(input: { lines: $lines, buyerIdentity: $buyerIdentity }) { cart { id } }
      }
      `, { lines, buyerIdentity: { countryCode: scenario.countryCode } });
        console.log("cartCreateRes", cartCreateRes);
        const cartCreateJson = await cartCreateRes.json();
        console.log("cartCreateJson", cartCreateJson);
        const cartId = cartCreateJson?.data?.cartCreate?.cart?.id;
        if (!cartId)
            throw new Error("Cart creation failed");
        console.log("cartId", cartId);
        // Set buyer identity address
        // Resolve city/province dynamically when missing using postal-code lookup (best-effort, country-agnostic)
        let derivedCity = scenario.city ?? undefined;
        let derivedProvinceCode = scenario.provinceCode ?? undefined;
        console.log("derivedCity", derivedCity);
        console.log("derivedProvinceCode", derivedProvinceCode);
        try {
            console.log("looking up city/province", scenario.countryCode, scenario.postalCode);
            if (scenario.countryCode && scenario.postalCode && (!derivedCity || !derivedProvinceCode)) {
                console.log("looking up city/province2", scenario.countryCode, scenario.postalCode);
                const looked = await lookupCityProvince(String(scenario.countryCode), String(scenario.postalCode));
                console.log("looked", looked);
                if (!derivedCity && looked.city)
                    derivedCity = looked.city;
                if (!derivedProvinceCode && looked.provinceCode)
                    derivedProvinceCode = looked.provinceCode;
            }
        }
        catch { }
        // Normalize province to Shopify subdivision code when possible (helps countries like TR)
        try {
            if (scenario.countryCode) {
                console.log("listing provinces", scenario.countryCode);
                const provinces = await listShopifyProvinces(shop.domain, scenario.countryCode).catch(() => []);
                const norm = (s) => String(s || '').trim().toLowerCase();
                const targetName = norm(derivedProvinceCode) || norm(derivedCity);
                if (!derivedProvinceCode && targetName && Array.isArray(provinces) && provinces.length > 0) {
                    console.log("listing provinces2", scenario.countryCode);
                    const exact = provinces.find((p) => norm(p.name) === targetName || norm(p.code) === targetName || norm(p.code).endsWith(`-${targetName}`));
                    const loose = exact || provinces.find((p) => norm(p.name).includes(targetName));
                    if (loose?.code) {
                        derivedProvinceCode = loose.code;
                    }
                }
            }
        }
        catch { }
        // Choose address1 from scenario if provided; otherwise synthesize
        const districtValue = String((scenario?.expectations?.district ?? "")).trim();
        const address1 = String(scenario?.address1 || '').trim() || [districtValue, String(scenario.city || "").trim()].filter(Boolean).join(", ") || "Sanity Test Address";
        console.log("address1", address1);
        let identityRes = await client.graphql(`#graphql
      mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart { id }
          userErrors { field message }
        }
      }
      `, {
            cartId,
            buyerIdentity: {
                countryCode: scenario.countryCode,
                deliveryAddressPreferences: [
                    {
                        deliveryAddress: {
                            country: scenario.countryCode, // Storefront MailingAddressInput uses 'country' not 'countryCode'
                            zip: scenario.postalCode ?? undefined, // 'zip' not 'postalCode'
                            province: derivedProvinceCode || derivedCity || undefined, // Storefront uses 'province' string
                            city: derivedCity,
                            address1,
                            address2: String(scenario?.address2 || '') || undefined,
                            firstName: String(scenario?.firstName || 'Test'),
                            lastName: String(scenario?.lastName || 'Runner'),
                            company: String(scenario?.company || 'Sanity Checker'),
                            phone: String(scenario?.phone || '0000000000'),
                        },
                    },
                ],
            },
        });
        console.log("identityRes", identityRes);
        let identityJson = await identityRes.json();
        console.log("identityJson", identityJson);
        const userErrors = identityJson?.data?.cartBuyerIdentityUpdate?.userErrors ?? [];
        console.log("userErrors", userErrors);
        if (userErrors.length > 0) {
            console.log("userErrors2", userErrors);
            // Retry with harmless default personal fields if demanded by API/shop settings
            const needsRetry = Array.isArray(userErrors) && userErrors.some((e) => {
                console.log("needsRetry", e);
                const fieldPath = (e?.field || []).join('.');
                const msg = String(e?.message || '').toLowerCase();
                return fieldPath.includes('firstName') || fieldPath.includes('lastName') || fieldPath.includes('phone') || msg.includes('first name') || msg.includes('last name') || msg.includes('phone');
            });
            if (needsRetry) {
                console.log("needsRetry2", needsRetry);
                identityRes = await client.graphql(`#graphql
          mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
            cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
              cart { id }
              userErrors { field message }
            }
          }
          `, {
                    cartId,
                    buyerIdentity: {
                        countryCode: scenario.countryCode,
                        deliveryAddressPreferences: [
                            {
                                deliveryAddress: {
                                    country: scenario.countryCode,
                                    zip: scenario.postalCode ?? undefined,
                                    province: derivedProvinceCode || derivedCity || undefined,
                                    city: derivedCity,
                                    address1,
                                    firstName: 'Test',
                                    lastName: 'Runner',
                                    company: 'Sanity Checker',
                                    phone: '0000000000',
                                },
                            },
                        ],
                    },
                });
                console.log("identityRes2", identityRes);
                identityJson = await identityRes.json();
                console.log("identityJson2", identityJson);
            }
        }
        const retryErrors = identityJson?.data?.cartBuyerIdentityUpdate?.userErrors ?? [];
        if (retryErrors.length > 0) {
            throw new Error(`Buyer identity error: ${JSON.stringify(retryErrors)}`);
        }
        console.log("identityJson3", identityJson);
        // Query delivery options
        // Apply discount code if provided
        if (scenario.discountCode) {
            console.log("applying discount code", scenario.discountCode);
            await client.graphql(`#graphql
        mutation CartDiscountCodesUpdate($cartId: ID!, $codes: [String!]!) {
          cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $codes) {
            userErrors { field message }
            cart { id }
          }
        }
        `, { cartId, codes: [scenario.discountCode] });
        }
        // small retry helper since carrier aggregators may respond slightly after address set
        async function fetchDeliveryOptionsOnce(cl) {
            return await cl.graphql(`#graphql
        query CartDeliveryOptions($cartId: ID!) {
          cart(id: $cartId) {
            id
            checkoutUrl
            cost { subtotalAmount { amount currencyCode } }
            deliveryGroups(first: 10) { nodes { id deliveryOptions { handle title estimatedCost { amount currencyCode } } } }
          }
        }
        `, { cartId });
        }
        console.log("fetching delivery options");
        const queryRes = await fetchDeliveryOptionsOnce(client);
        console.log("queryRes", queryRes);
        const queryJson = await queryRes.json();
        console.log("queryJson", queryJson);
        let checkoutUrl = queryJson?.data?.cart?.checkoutUrl;
        if (queryRes.status === 403) {
            console.log("403");
            // Token likely revoked; rotate and retry once
            const rotated = await rotateStorefrontToken(shop.domain);
            token = rotated.token;
            version = rotated.version;
            const retryClient = await unauthenticatedStorefrontClient(shop.domain, rotated.token, rotated.version);
            const retryRes = await retryClient.graphql(`#graphql
        query CartDeliveryOptions($cartId: ID!) {
          cart(id: $cartId) {
            id
            checkoutUrl
            cost { subtotalAmount { amount currencyCode } }
            deliveryGroups(first: 10) { nodes { id deliveryOptions { handle title estimatedCost { amount currencyCode } } } }
          }
        }`, { cartId });
            const retryJson = await retryRes.json();
            if (!retryRes.ok)
                throw new Error(`Storefront query failed after rotation: ${retryRes.status}`);
            const groups = extractGroupsFromCart(retryJson?.data?.cart);
            const subtotal = retryJson?.data?.cart?.cost?.subtotalAmount ?? null;
            const options = groups.flatMap((g) => g.deliveryOptions ?? []);
            const diagnostics = buildDiagnostics(groups, options, subtotal, scenario.expectations);
            diagnostics.push({ code: "TOKEN_ROTATED", message: "Storefront token was rotated due to 403" });
            const status = (!options || options.length === 0) ? "FAIL" : (diagnostics.length > 0 ? "WARN" : "PASS");
            let screenshotUrl;
            const captureMode = String(process.env.SCREENSHOT_CAPTURE_MODE || 'warn_fail_only').toLowerCase();
            const shouldCaptureRetry = scenario.screenshotEnabled && (captureMode === 'all' ||
                (captureMode === 'warn_fail_only' && (status === 'WARN' || status === 'FAIL')) ||
                (captureMode === 'fail_only' && status === 'FAIL'));
            if (shouldCaptureRetry) {
                try {
                    const co = retryJson?.data?.cart?.checkoutUrl;
                    if (co) {
                        const buf = await captureCheckoutScreenshot(co, { storefrontPassword: process.env.STOREFRONT_PASSWORD }).catch(() => null);
                        if (buf) {
                            const key = buildScreenshotKey(scenario.shopId, run.id);
                            const uploaded = await r2PutObject({ key, contentType: "image/png", body: buf });
                            screenshotUrl = uploaded.url;
                        }
                    }
                    else {
                        diagnostics.push({ code: "SCREENSHOT_SKIPPED", message: "checkoutUrl not available" });
                    }
                }
                catch (e) {
                    diagnostics.push({ code: "SCREENSHOT_ERROR", message: String(e?.message || e) });
                }
            }
            await completeRun(run.id, status, { groups, options, subtotal }, diagnostics, undefined, screenshotUrl);
            return await db.run.findUnique({ where: { id: run.id } });
        }
        let groups = extractGroupsFromCart(queryJson?.data?.cart);
        let subtotal = queryJson?.data?.cart?.cost?.subtotalAmount ?? null;
        let options = groups.flatMap((g) => g.deliveryOptions ?? []);
        console.log("groupsLen", Array.isArray(groups) ? groups.length : 0, "optionsLen", options.length);
        // Brief retry (2x) if first fetch returns empty; some carriers are eventually consistent after identity update
        if ((!options || options.length === 0) && queryRes.ok) {
            console.log("2x retry");
            for (let i = 0; i < 2; i++) {
                await new Promise(r => setTimeout(r, 400));
                const r2 = await fetchDeliveryOptionsOnce(client);
                const j2 = await r2.json();
                const groups2 = extractGroupsFromCart(j2?.data?.cart);
                if (groups2.length > 0) {
                    groups = groups2;
                }
                subtotal = j2?.data?.cart?.cost?.subtotalAmount ?? subtotal;
                options = groups.flatMap((g) => g.deliveryOptions ?? []);
                if (options && options.length > 0)
                    break;
            }
        }
        const diagnostics = buildDiagnostics(groups, options, subtotal, scenario.expectations);
        console.log("diagnostics", diagnostics);
        // Enrich diagnostics when no rates were returned
        if (!options || options.length === 0) {
            console.log("no options");
            try {
                console.log("fetching market enabled, variant infos, country req");
                const [marketEnabled, variantInfos, countryReq] = await Promise.all([
                    isCountryEnabledInMarkets(shop.domain, scenario.countryCode).catch(() => undefined),
                    fetchVariantInfos(shop.domain, Array.isArray(scenario.productVariantIds) ? scenario.productVariantIds : []).catch(() => []),
                    getShopifyCountryRequirements(shop.domain, scenario.countryCode).catch(() => undefined),
                ]);
                console.log("marketEnabled", marketEnabled);
                console.log("variantInfos", variantInfos);
                console.log("countryReq", countryReq);
                if ((preflightVariantInfos.length === 0) && (variantInfos.length === 0)) {
                    diagnostics.push({ code: "VARIANTS_UNAVAILABLE", message: "Selected variants are not visible to Storefront. Ensure products are published to the Online Store and IDs are valid." });
                }
                if (marketEnabled === false) {
                    diagnostics.push({ code: "MARKET_DISABLED", message: `${String(scenario.countryCode).toUpperCase()} is not enabled in Shopify Markets` });
                }
                const nonPhysical = (variantInfos || []).some(v => !v.requiresShipping);
                const zeroWeight = (variantInfos || []).some(v => v.requiresShipping && ((v.grams || 0) === 0));
                if (nonPhysical) {
                    diagnostics.push({ code: "NON_PHYSICAL_PRODUCT", message: "Cart contains non-shippable items (requiresShipping = false)." });
                }
                if (zeroWeight) {
                    diagnostics.push({ code: "WEIGHT_MISSING", message: "One or more shippable items have zero weight." });
                }
                if (countryReq && countryReq.provinceRequired && !derivedProvinceCode) {
                    diagnostics.push({ code: "PROVINCE_REQUIRED", message: "Province/state is required for this country but none was provided or resolved." });
                }
                if (countryReq && countryReq.zipRequired && !scenario.postalCode) {
                    diagnostics.push({ code: "POSTAL_REQUIRED", message: "Postal/ZIP code is required for this country but none was provided." });
                }
                // Attach context to help compare with Checkout
                diagnostics.push({
                    code: "CART_CONTEXT",
                    context: {
                        countryCode: scenario.countryCode,
                        postalCode: scenario.postalCode ?? null,
                        provinceCode: derivedProvinceCode ?? null,
                        city: derivedCity ?? null,
                        address1,
                        linesCount: Array.isArray(lines) ? lines.length : 0,
                        variants: ((preflightVariantInfos.length > 0 ? preflightVariantInfos : variantInfos) || []).map(v => ({ id: v.id, requiresShipping: v.requiresShipping, grams: v.grams })),
                    }
                });
                console.log("diagnostics2", diagnostics);
            }
            catch {
                console.log("error diagnostics");
            }
        }
        if (diagnostics.length > 0) {
            const links = buildAdminLinks(shop.domain, {});
            diagnostics.push({ code: "ADMIN_LINKS", links });
        }
        let status;
        if (!options || options.length === 0) {
            status = "FAIL";
        }
        else if (diagnostics.length > 0) {
            // If this scenario uses a discount code and the diagnostic is specifically
            // about free shipping being missing, downgrade to WARN. Discount-code-based
            // free shipping shows up as a non-zero estimatedCost in delivery options
            // but becomes free at checkout. Treat that case as a warning by default.
            const hasFreeMissing = Array.isArray(diagnostics) && diagnostics.some((d) => d?.code === "FREE_SHIPPING_MISSING");
            if (scenario.discountCode && hasFreeMissing) {
                status = "WARN";
            }
            else {
                status = (scenario.alertLevel === "FAIL") ? "FAIL" : "WARN";
            }
        }
        else {
            status = "PASS";
        }
        let screenshotUrlFinal;
        const captureMode = String(process.env.SCREENSHOT_CAPTURE_MODE || 'warn_fail_only').toLowerCase();
        const shouldCapture = scenario.screenshotEnabled && (captureMode === 'all' ||
            (captureMode === 'warn_fail_only' && (status === 'WARN' || status === 'FAIL')) ||
            (captureMode === 'fail_only' && status === 'FAIL'));
        if (shouldCapture) {
            try {
                const co = checkoutUrl;
                if (co) {
                    const buf = await captureCheckoutScreenshot(co, { storefrontPassword: process.env.STOREFRONT_PASSWORD }).catch(() => null);
                    if (buf) {
                        const key = buildScreenshotKey(scenario.shopId, run.id);
                        const uploaded = await r2PutObject({ key, contentType: "image/png", body: buf });
                        screenshotUrlFinal = uploaded.url;
                    }
                }
                else {
                    diagnostics.push({ code: "SCREENSHOT_SKIPPED", message: "checkoutUrl not available" });
                }
            }
            catch (e) {
                diagnostics.push({ code: "SCREENSHOT_ERROR", message: String(e?.message || e) });
            }
        }
        await completeRun(run.id, status, { groups, options, subtotal }, diagnostics, undefined, screenshotUrlFinal);
        console.log("completeRun last", status);
        return await db.run.findUnique({ where: { id: run.id } });
    }
    catch (err) {
        console.log("error completeRun last", err);
        const message = String(err?.message || 'Unknown error');
        const isTokenIssue = message.includes('Storefront token') || message.includes('Offline admin session') || message.includes('storefrontAccessToken');
        if (isTokenIssue) {
            await completeRun(run.id, "BLOCKED", null, [{ code: "STOREFRONT_TOKEN_ERROR", message }]);
        }
        else {
            await completeRun(run.id, "ERROR", null, [{ code: "EXCEPTION", message }]);
        }
        return await db.run.findUnique({ where: { id: run.id } });
    }
}
