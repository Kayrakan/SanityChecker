export const BASIC_PLAN = "basic";
export const PRO_PLAN = "pro";
export const SCALE_PLAN = "scale";
export const PLAN_ORDER = [SCALE_PLAN, PRO_PLAN, BASIC_PLAN];
export const PLAN_DISPLAY_INFO = {
    [BASIC_PLAN]: { label: "Basic", price: "$29/mo", cap: 10 },
    [PRO_PLAN]: { label: "Pro", price: "$59/mo", cap: 30 },
    [SCALE_PLAN]: { label: "Scale", price: "$99/mo", cap: 60 },
};
