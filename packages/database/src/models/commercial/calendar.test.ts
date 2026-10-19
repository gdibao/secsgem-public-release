import { describe, expect, it } from 'vitest';

import { addCalendarMonths, addCalendarYears } from './calendar';

describe('commercial calendar arithmetic', () => {
  it('clamps month-end dates without overflowing into the following month', () => {
    const january31 = new Date('2024-01-31T08:30:00.000Z');

    expect(addCalendarMonths(january31, 1).toISOString()).toBe('2024-02-29T08:30:00.000Z');
    expect(addCalendarMonths(january31, 2).toISOString()).toBe('2024-03-31T08:30:00.000Z');
  });

  it('clamps leap-day yearly expiries to the final day of February', () => {
    const leapDay = new Date('2024-02-29T08:30:00.000Z');

    expect(addCalendarYears(leapDay, 1).toISOString()).toBe('2025-02-28T08:30:00.000Z');
  });
});
