import prisma from "../db.server";
import { unauthenticatedStorefrontClient } from "./shopify-clients.server";
import { ensureStorefrontToken } from "./storefront-token.server";
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
    const prices = (options ?? []).map(o => Number(o.estimatedCost.amount));
    if (expectations.min != null && prices.some(p => p < expectations.min)) {
      diags.push({ code: "PRICE_TOO_LOW", message: `Some rates below ${expectations.min}` });
    }
    if (expectations.max != null && prices.some(p => p > expectations.max)) {
      diags.push({ code: "PRICE_TOO_HIGH", message: `Some rates above ${expectations.max}` });
    }
  }
  return diags;
}

export async function runScenarioById(scenarioId: string) {
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

  const run = await createRun(scenario.id, shop.id);

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
    const identityRes = await client.graphql(
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
              },
            },
          ],
        },
      }
    );
    const identityJson = await identityRes.json();
    const userErrors = identityJson?.data?.cartBuyerIdentityUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new Error(`Buyer identity error: ${JSON.stringify(userErrors)}`);
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
    const groups = queryJson?.data?.cart?.deliveryGroups ?? [];
    const subtotal: Money | null = queryJson?.data?.cart?.cost?.subtotalAmount ?? null;
    const options: DeliveryOption[] = groups.flatMap((g: any) => g.deliveryOptions ?? []);

    const diagnostics = buildDiagnostics(groups, options, subtotal, scenario.expectations as any);
    if (diagnostics.length > 0) {
      const links = buildAdminLinks(shop.domain, {});
      diagnostics.push({ code: "ADMIN_LINKS", links });
    }
    const status = (!options || options.length === 0) ? "FAIL" : (diagnostics.length > 0 ? "WARN" : "PASS");

    await completeRun(run.id, status, { groups, options, subtotal }, diagnostics);
    return await db.run.findUnique({ where: { id: run.id } });
  } catch (err: any) {
    await completeRun(run.id, "ERROR", null, [{ code: "EXCEPTION", message: err?.message }]);
    return await db.run.findUnique({ where: { id: run.id } });
  }
}


