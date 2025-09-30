export function buildAdminLinks(shop, hints) {
    // Best-effort deep links (Shopify Admin URLs). Some are approximate but helpful.
    return {
        profiles: `https://${shop}/admin/settings/shipping/policies`,
        shippingAndDelivery: `https://${shop}/admin/settings/shipping`,
        markets: `https://${shop}/admin/settings/markets`,
        discounts: `https://${shop}/admin/discounts`,
        product: hints.productId ? `https://${shop}/admin/products/${hints.productId}` : undefined,
    };
}
