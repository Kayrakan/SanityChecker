import prisma from "../db.server";
import { unauthenticatedStorefrontClient } from "./shopify-clients.server";
import { ensureStorefrontToken, rotateStorefrontToken } from "./storefront-token.server";
import { createRun, completeRun } from "../models/run.server";
import { buildAdminLinks } from "./diagnostics-links.server";

type Money = { amount: string; currencyCode: string };
type DeliveryOption = { handle: string; title: string; estimatedCost: Money };

function buildDiagnostics(groups: any[], options: DeliveryOption[] | null, subtotal?: Money | null, expectations?: any) {
  const diags: any[] = [];
  const anyGroupEmpty = (groups ?? []).some((g: any) => (g.deliveryOptions ?? []).length === 0);
  if (!options || options.length === 0 || anyGroupEmpty) {
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
  if (expectations?.freeShippingThreshold != null && options && options.length > 0) {
    const hasFree = options.some(o => Number(o.estimatedCost.amount) === 0);
    if (!hasFree) {
      diags.push({
        code: "FREE_SHIPPING_MISSING",
        message: `Expected free shipping >= ${expectations.freeShippingThreshold}`,
      });
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
  if (expectations?.min != null || expectations?.max != null) {
    const opts = (options ?? []);
    let targetOptions: DeliveryOption[] = opts;
    const target = (expectations?.boundsTarget || 'CHEAPEST') as string;
    if (target === 'TITLE') {
      const needle = String(expectations?.boundsTitle || '').toLowerCase();
      targetOptions = opts.filter(o => o.title?.toLowerCase().includes(needle));
      if (needle && targetOptions.length === 0) {
        diags.push({ code: "TARGET_RATE_NOT_FOUND", message: `No rate with title containing "${expectations.boundsTitle}"` });
      }
    }
    let prices: number[] = targetOptions.map(o => Number(o.estimatedCost.amount));
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
  return diags;
}

export async function runScenarioById(scenarioId: string, runId?: string) {
  const db: any = prisma;
  const scenario = await db.scenario.findUnique({ where: { id: scenarioId }, include: { shop: { include: { settings: true } } } });
  if (!scenario) throw new Error("Scenario not found");
  const { shop } = scenario;
  // Ensure a Storefront token exists (provision via Admin API if needed)
  const { token, version } = await ensureStorefrontToken(shop.domain);
  const client = await unauthenticatedStorefrontClient(shop.domain, token, version);

  // Build cart
  const lines = scenario.productVariantIds.map((variantId: string, idx: number) => ({
    merchandiseId: variantId,
    quantity: scenario.quantities[idx] ?? 1,
  }));

  // Use provided runId when present (idempotent). Otherwise create a new Run.
  let run = runId ? await db.run.findUnique({ where: { id: runId } }) : null;
  if (!run) {
    run = await createRun(scenario.id, shop.id);
  }

  try {
    const cartCreateRes = await client.graphql(
      `#graphql
      mutation CreateCart($lines: [CartLineInput!]!) {
        cartCreate(input: { lines: $lines }) { cart { id } }
      }
      `,
      { lines }
    );
    const cartCreateJson = await cartCreateRes.json();
    const cartId = cartCreateJson?.data?.cartCreate?.cart?.id;
    if (!cartId) throw new Error("Cart creation failed");

    // Set buyer identity address
    let identityRes = await client.graphql(
      `#graphql
      mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart { id }
          userErrors { field message }
        }
      }
      `,
      {
        cartId,
        buyerIdentity: {
          countryCode: scenario.countryCode,
          deliveryAddressPreferences: [
            {
              deliveryAddress: {
                countryCode: scenario.countryCode,
                postalCode: scenario.postalCode ?? undefined,
                provinceCode: scenario.provinceCode ?? undefined,
                city: scenario.city ?? undefined,
              },
            },
          ],
        },
      }
    );
    let identityJson = await identityRes.json();
    const userErrors = identityJson?.data?.cartBuyerIdentityUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      // Retry with harmless default personal fields if demanded by API/shop settings
      const needsRetry = Array.isArray(userErrors) && userErrors.some((e: any) => {
        const fieldPath = (e?.field || []).join('.') as string;
        const msg = String(e?.message || '').toLowerCase();
        return fieldPath.includes('firstName') || fieldPath.includes('lastName') || fieldPath.includes('phone') || msg.includes('first name') || msg.includes('last name') || msg.includes('phone');
      });
      if (needsRetry) {
        identityRes = await client.graphql(
          `#graphql
          mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
            cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
              cart { id }
              userErrors { field message }
            }
          }
          `,
          {
            cartId,
            buyerIdentity: {
              countryCode: scenario.countryCode,
              deliveryAddressPreferences: [
                {
                  deliveryAddress: {
                    countryCode: scenario.countryCode,
                    postalCode: scenario.postalCode ?? undefined,
                    provinceCode: scenario.provinceCode ?? undefined,
                    city: scenario.city ?? undefined,
                    firstName: 'Test',
                    lastName: 'Runner',
                    company: 'Sanity Checker',
                    phone: '0000000000',
                  },
                },
              ],
            },
          }
        );
        identityJson = await identityRes.json();
      }
    }
    const retryErrors = identityJson?.data?.cartBuyerIdentityUpdate?.userErrors ?? [];
    if (retryErrors.length > 0) {
      throw new Error(`Buyer identity error: ${JSON.stringify(retryErrors)}`);
    }

    // Query delivery options
    // Apply discount code if provided
    if (scenario.discountCode) {
      await client.graphql(
        `#graphql
        mutation CartDiscountCodesUpdate($cartId: ID!, $codes: [String!]!) {
          cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $codes) {
            userErrors { field message }
            cart { id }
          }
        }
        `,
        { cartId, codes: [scenario.discountCode] }
      );
    }

    const queryRes = await client.graphql(
      `#graphql
      query CartDeliveryOptions($cartId: ID!) {
        cart(id: $cartId) {
          id
          cost { subtotalAmount { amount currencyCode } }
          deliveryGroups {
            id
            deliveryOptions {
              handle
              title
              estimatedCost { amount currencyCode }
            }
          }
        }
      }
      `,
      { cartId }
    );
    const queryJson = await queryRes.json();
    if (queryRes.status === 403) {
      // Token likely revoked; rotate and retry once
      const rotated = await rotateStorefrontToken(shop.domain);
      const retryClient = await unauthenticatedStorefrontClient(shop.domain, rotated.token, rotated.version);
      const retryRes = await retryClient.graphql(
        `#graphql
        query CartDeliveryOptions($cartId: ID!) {
          cart(id: $cartId) {
            id
            cost { subtotalAmount { amount currencyCode } }
            deliveryGroups { id deliveryOptions { handle title estimatedCost { amount currencyCode } } }
          }
        }`,
        { cartId }
      );
      const retryJson = await retryRes.json();
      if (!retryRes.ok) throw new Error(`Storefront query failed after rotation: ${retryRes.status}`);
      const groups = retryJson?.data?.cart?.deliveryGroups ?? [];
      const subtotal: Money | null = retryJson?.data?.cart?.cost?.subtotalAmount ?? null;
      const options: DeliveryOption[] = groups.flatMap((g: any) => g.deliveryOptions ?? []);
      const diagnostics = buildDiagnostics(groups, options, subtotal, scenario.expectations as any);
      diagnostics.push({ code: "TOKEN_ROTATED", message: "Storefront token was rotated due to 403" });
      const status = (!options || options.length === 0) ? "FAIL" : (diagnostics.length > 0 ? "WARN" : "PASS");
      await completeRun(run.id, status, { groups, options, subtotal }, diagnostics);
      return await db.run.findUnique({ where: { id: run.id } });
    }
    const groups = queryJson?.data?.cart?.deliveryGroups ?? [];
    const subtotal: Money | null = queryJson?.data?.cart?.cost?.subtotalAmount ?? null;
    const options: DeliveryOption[] = groups.flatMap((g: any) => g.deliveryOptions ?? []);

    const diagnostics = buildDiagnostics(groups, options, subtotal, scenario.expectations as any);
    if (diagnostics.length > 0) {
      const links = buildAdminLinks(shop.domain, {});
      diagnostics.push({ code: "ADMIN_LINKS", links });
    }
    let status: "PASS" | "WARN" | "FAIL";
    if (!options || options.length === 0) {
      status = "FAIL";
    } else if (diagnostics.length > 0) {
      status = (scenario.alertLevel === "FAIL") ? "FAIL" : "WARN";
    } else {
      status = "PASS";
    }

    await completeRun(run.id, status, { groups, options, subtotal }, diagnostics);
    return await db.run.findUnique({ where: { id: run.id } });
  } catch (err: any) {
    await completeRun(run.id, "ERROR", null, [{ code: "EXCEPTION", message: err?.message }]);
    return await db.run.findUnique({ where: { id: run.id } });
  }
}

