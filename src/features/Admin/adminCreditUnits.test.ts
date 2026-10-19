import { describe, expect, it } from 'vitest';

import {
  formatAdminCredits,
  toAdminAtomicCredits,
  toAdminDisplayCredits,
} from './adminCreditUnits';

describe('admin credit units', () => {
  it('normalizes form values and API values at the admin boundary', () => {
    expect(toAdminAtomicCredits(2.5)).toBe(2_500_000);
    expect(toAdminDisplayCredits(2_500_000)).toBe(2.5);
    expect(toAdminDisplayCredits('2500000')).toBe(2.5);
  });

  it('formats all admin credit values with an explicit M suffix', () => {
    expect(formatAdminCredits(2_500_000)).toBe('2.5 M');
    expect(formatAdminCredits(null)).toBe('0 M');
  });
});
