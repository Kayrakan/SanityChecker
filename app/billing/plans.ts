export const BASIC_PLAN = "basic" as const;
export const PRO_PLAN = "pro" as const;
export const SCALE_PLAN = "scale" as const;

export const PLAN_ORDER = [SCALE_PLAN, PRO_PLAN, BASIC_PLAN] as const;

export const PLAN_DISPLAY_INFO = {
  [BASIC_PLAN]: { label: "Basic", price: "$29/mo", cap: 10 },
  [PRO_PLAN]: { label: "Pro", price: "$59/mo", cap: 30 },
  [SCALE_PLAN]: { label: "Scale", price: "$99/mo", cap: 60 },
} as const;

export type PlanId = typeof BASIC_PLAN | typeof PRO_PLAN | typeof SCALE_PLAN;
