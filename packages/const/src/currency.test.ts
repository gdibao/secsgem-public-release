import { describe, expect, it } from 'vitest';

import { DISPLAY_CREDITS_UNIT, toAtomicCredits, toDisplayCredits } from './currency';

describe('credit unit conversion', () => {
  it('uses one million atomic credits per displayed M Credit', () => {
    expect(DISPLAY_CREDITS_UNIT).toBe(1_000_000);
    expect(toAtomicCredits(1)).toBe(1_000_000);
    expect(toAtomicCredits(1.25)).toBe(1_250_000);
    expect(toDisplayCredits(1_250_000)).toBe(1.25);
  });

  it('rounds form decimals to integer atomic credits', () => {
    expect(toAtomicCredits(0.000_001_4)).toBe(1);
    expect(toAtomicCredits(-1.5)).toBe(-1_500_000);
  });
});
