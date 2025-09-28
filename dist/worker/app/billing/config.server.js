const truthyValues = new Set(["1", "true", "yes", "on"]);
export function isBillingTestMode() {
    const override = process.env.SHOPIFY_BILLING_TEST_MODE;
    if (override !== undefined) {
        return truthyValues.has(override.trim().toLowerCase());
    }
    return process.env.NODE_ENV !== "production";
}
