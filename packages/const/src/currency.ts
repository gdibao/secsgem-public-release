// in 2025.10.22
export const USD_TO_CNY = 7.12;

export const CREDITS_PER_DOLLAR = 1_000_000;
export const DISPLAY_CREDITS_UNIT = CREDITS_PER_DOLLAR;
export const DEFAULT_PRICING_CREDIT_MULTIPLIER = 1.35;

export const toAtomicCredits = (displayCredits: number) =>
  Math.round(displayCredits * DISPLAY_CREDITS_UNIT);

export const toDisplayCredits = (atomicCredits: number) => atomicCredits / DISPLAY_CREDITS_UNIT;
