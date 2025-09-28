import { PLAN_DISPLAY_INFO, PLAN_ORDER, } from "./plans";
import { isBillingTestMode } from "./config.server";
export async function getBillingSummary({ billing, bypassBilling, }) {
    if (bypassBilling) {
        return { mode: "development", hasActivePayment: false };
    }
    const status = await billing.check({
        plans: [...PLAN_ORDER],
        isTest: isBillingTestMode(),
    });
    const subscriptions = status?.appSubscriptions ?? [];
    const activeSubscription = selectActiveSubscription(subscriptions);
    if (!status?.hasActivePayment || !activeSubscription) {
        return { mode: "live", hasActivePayment: false };
    }
    const planKey = resolvePlanId(activeSubscription.name);
    const planMeta = planKey ? PLAN_DISPLAY_INFO[planKey] : undefined;
    const trialEndsOn = computeTrialEnd(activeSubscription);
    return {
        mode: "live",
        hasActivePayment: true,
        activePlan: {
            planId: activeSubscription.name,
            label: planMeta?.label ?? activeSubscription.name,
            price: planMeta?.price,
            cap: planMeta?.cap,
            status: activeSubscription.status,
            test: Boolean(activeSubscription.test),
            onTrial: Boolean(trialEndsOn && trialEndsOn > Date.now()),
            trialEndsOn: trialEndsOn ? new Date(trialEndsOn).toISOString() : null,
            currentPeriodEnd: activeSubscription.currentPeriodEnd ?? null,
        },
    };
}
function selectActiveSubscription(subscriptions) {
    for (const plan of PLAN_ORDER) {
        const match = subscriptions.find((sub) => sub?.name === plan && sub?.status === "ACTIVE");
        if (match)
            return match;
    }
    return subscriptions.find((sub) => sub?.status === "ACTIVE") ?? subscriptions[0];
}
function computeTrialEnd(subscription) {
    if (!subscription?.trialDays || !subscription?.createdAt) {
        return null;
    }
    const start = new Date(subscription.createdAt);
    if (Number.isNaN(start.getTime())) {
        return null;
    }
    const end = new Date(start.getTime() + subscription.trialDays * 24 * 60 * 60 * 1000);
    return end.getTime();
}
function resolvePlanId(name) {
    if (!name)
        return undefined;
    return PLAN_ORDER.find((plan) => plan === name);
}
