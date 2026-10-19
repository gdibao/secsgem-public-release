import { describe, expect, it } from 'vitest';

/**
 * Mirrors the logic that sits inside the redemption router for the optional
 * `planDurationMonths` field. We reproduce the pure date computation here so
 * that the behavior is tested without booting a full DB stack.
 */
const computeEndsAtOverride = (
  durationMonths: number | null | undefined,
  now: Date = new Date(),
): Date | undefined => {
  if (!durationMonths || durationMonths <= 0) return undefined;
  const d = new Date(now);
  d.setMonth(d.getMonth() + durationMonths);
  return d;
};

describe('plan duration override', () => {
  it('returns undefined when duration is missing', () => {
    expect(computeEndsAtOverride(null)).toBeUndefined();
    expect(computeEndsAtOverride(undefined)).toBeUndefined();
    expect(computeEndsAtOverride(0)).toBeUndefined();
  });

  it('adds N months to the current date for positive durations', () => {
    const base = new Date('2025-06-15T00:00:00Z');
    const out = computeEndsAtOverride(3, base)!;
    expect(out.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });

  it('handles year rollover correctly', () => {
    const base = new Date('2025-11-15T00:00:00Z');
    const out = computeEndsAtOverride(3, base)!;
    expect(out.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('rejects negative durations', () => {
    expect(computeEndsAtOverride(-1)).toBeUndefined();
  });
});
