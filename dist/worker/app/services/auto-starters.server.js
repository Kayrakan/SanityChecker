import prisma from "../db.server.js";
import { getAdminClientByShop } from "./shopify-clients.server.js";
import { defaultCountries, getTestAddress } from "./test-addresses.server.js";
export async function seedStarterScenarios(shopDomain, shopId) {
    const count = await prisma.scenario.count({ where: { shopId } });
    if (count > 0)
        return;
    const { admin } = await getAdminClientByShop(shopDomain);
    // Pull a few products with variant IDs and weights
    const res = await admin.graphql(`#graphql
    query StarterProducts {
      products(first: 10) {
        nodes { id title variants(first: 5) { nodes { id weight } } }
      }
    }`);
    const json = await res.json();
    const products = json?.data?.products?.nodes ?? [];
    const variants = products.flatMap((p) => p.variants?.nodes ?? []);
    if (variants.length === 0)
        return;
    const light = variants.find(v => (v.weight ?? 0) > 0 && (v.weight ?? 0) <= 0.5) ?? variants[0];
    const heavy = variants.find(v => (v.weight ?? 0) >= 2) ?? variants[variants.length - 1];
    const countries = defaultCountries();
    for (const code of countries) {
        const addr = getTestAddress(code);
        await prisma.scenario.create({
            data: {
                shopId,
                name: `${code} / light`,
                active: true,
                countryCode: addr.countryCode,
                postalCode: addr.postalCode,
                provinceCode: addr.provinceCode,
                productVariantIds: [light.id],
                quantities: [1],
            },
        });
        await prisma.scenario.create({
            data: {
                shopId,
                name: `${code} / heavy`,
                active: true,
                countryCode: addr.countryCode,
                postalCode: addr.postalCode,
                provinceCode: addr.provinceCode,
                productVariantIds: [heavy.id],
                quantities: [1],
            },
        });
    }
    // Mixed-cart scenario (US) with both variants to catch merged-rate issues
    const us = getTestAddress("US");
    await prisma.scenario.create({
        data: {
            shopId,
            name: `US / mixed cart`,
            active: true,
            countryCode: us.countryCode,
            postalCode: us.postalCode,
            provinceCode: us.provinceCode,
            productVariantIds: [light.id, heavy.id],
            quantities: [1, 1],
        },
    });
}
