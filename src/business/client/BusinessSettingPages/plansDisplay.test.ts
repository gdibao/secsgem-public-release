import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  formatPlanCurrencyAmount,
  getAvailableBillingCycles,
  getConfiguredVisiblePaidPlans,
  getDefaultMobilePlanTarget,
  getPlanYearlyDiscountLabel,
  getPlanYearlyDiscountPercent,
  getVisiblePaidPlans,
  getYearlyCycleDiscountLabel,
  PLAN_DISPLAY_CURRENCY,
  resolvePlanCyclePrice,
} from './plansDisplay';

describe('plans display helpers', () => {
  it('chooses the first available non-current plan for the mobile action', () => {
    expect(
      getDefaultMobilePlanTarget(
        [Plans.Hobby, Plans.Starter, Plans.Premium],
        Plans.Hobby,
        (plan) => plan === Plans.Premium,
      ),
    ).toBe(Plans.Premium);
  });

  it('returns undefined when no non-current plan can be purchased', () => {
    expect(getDefaultMobilePlanTarget([Plans.Hobby], Plans.Hobby, () => false)).toBeUndefined();
  });

  it('hides the free plan from the public plans page', () => {
    expect(getVisiblePaidPlans([Plans.Free, Plans.Hobby, Plans.Starter, Plans.Premium])).toEqual([
      Plans.Hobby,
      Plans.Starter,
      Plans.Premium,
    ]);
  });

  it('only displays paid plans present in the catalog', () => {
    expect(
      getConfiguredVisiblePaidPlans(
        [Plans.Free, Plans.Hobby, Plans.Starter, Plans.Premium],
        [Plans.Free, Plans.Starter],
      ),
    ).toEqual([Plans.Starter]);
  });

  it('does not fall back to the full plan order when the catalog is empty or unavailable', () => {
    expect(getConfiguredVisiblePaidPlans([Plans.Free, Plans.Hobby, Plans.Starter], [])).toEqual([]);
    expect(
      getConfiguredVisiblePaidPlans([Plans.Free, Plans.Hobby, Plans.Starter], undefined),
    ).toEqual([]);
  });

  it('formats prices with the catalog currency', () => {
    expect(formatPlanCurrencyAmount(29, 'USD')).toContain('29');
    expect(formatPlanCurrencyAmount(29, 'CNY')).toContain('¥');
  });

  it('uses USD as the display fallback currency to match backend pricing defaults', () => {
    expect(PLAN_DISPLAY_CURRENCY).toBe('USD');
    expect(formatPlanCurrencyAmount(29)).toContain('29');
  });

  it('calculates yearly discounts from monthly and yearly catalog prices', () => {
    expect(getPlanYearlyDiscountPercent(59, 590)).toBe(17);
    expect(getPlanYearlyDiscountPercent(0, 590)).toBe(0);
  });

  it('resolves yearly prices with a monthly headline and yearly total detail', () => {
    const price = resolvePlanCyclePrice(
      {
        currency: 'CNY',
        monthlyPrice: 59,
        yearlyPrice: 590,
      },
      'yearly',
    );

    expect(price.amount).toBe(590);
    expect(price.label).toContain('49.17');
    expect(price.unit).toBe('每月');
    expect(price.discountPercent).toBe(17);
    expect(price.secondaryLabel).toContain('590');
    expect(price.secondaryLabel).toContain('优惠 17%');
  });

  it('builds the yearly tab discount label from configured labels or max computed discount', () => {
    expect(
      getYearlyCycleDiscountLabel([
        { monthlyPrice: 59, yearlyPrice: 590 },
        { monthlyPrice: 99, yearlyDiscountLabel: '  最高优惠 37% ', yearlyPrice: 748 },
      ]),
    ).toBe('最高优惠 37%');

    expect(
      getYearlyCycleDiscountLabel([
        { monthlyPrice: 59, yearlyPrice: 590 },
        { monthlyPrice: 99, yearlyPrice: 950 },
      ]),
    ).toBe('最高优惠 20%');
  });

  it('derives billing cycle tabs from configured catalog prices', () => {
    expect(
      getAvailableBillingCycles([
        { monthlyPrice: 59, yearlyPrice: 590 },
        { monthlyPrice: 99, yearlyPrice: 950 },
      ]),
    ).toEqual(['yearly', 'monthly']);

    expect(
      getAvailableBillingCycles([
        { lifetimePrice: 999, monthlyPrice: 59, oneTimePrice: 499, yearlyPrice: 590 },
      ]),
    ).toEqual(['yearly', 'monthly', 'one_time', 'lifetime']);

    expect(getAvailableBillingCycles([])).toEqual([]);
    expect(
      getAvailableBillingCycles([
        { monthlyPrice: 0, yearlyPrice: 0 },
        { lifetimePrice: 0, oneTimePrice: 0 },
      ]),
    ).toEqual([]);
  });

  it('does not estimate one-time or lifetime prices when they are not configured', () => {
    const oneTime = resolvePlanCyclePrice(
      {
        currency: 'USD',
        monthlyPrice: 59,
        yearlyPrice: 590,
      },
      'one_time',
    );
    const lifetime = resolvePlanCyclePrice(
      {
        currency: 'USD',
        monthlyPrice: 59,
        yearlyPrice: 590,
      },
      'lifetime',
    );

    expect(oneTime.amount).toBe(0);
    expect(oneTime.isAvailable).toBe(false);
    expect(oneTime.secondaryLabel).toContain('未配置');
    expect(lifetime.amount).toBe(0);
    expect(lifetime.isAvailable).toBe(false);
    expect(lifetime.secondaryLabel).toContain('未配置');
  });

  it('prefers configured one-time prices over fallback estimates', () => {
    const price = resolvePlanCyclePrice(
      {
        currency: 'CNY',
        monthlyPrice: 59,
        oneTimePrice: 499,
        yearlyPrice: 590,
      },
      'one_time',
    );

    expect(price.amount).toBe(499);
    expect(price.isAvailable).toBe(true);
  });

  it('prefers configured lifetime prices over fallback estimates', () => {
    const price = resolvePlanCyclePrice(
      {
        currency: 'CNY',
        lifetimePrice: 999,
        monthlyPrice: 59,
        yearlyPrice: 590,
      },
      'lifetime',
    );

    expect(price.amount).toBe(999);
    expect(price.isAvailable).toBe(true);
  });

  it('builds per-plan yearly discount labels without inventing discounts', () => {
    expect(
      getPlanYearlyDiscountLabel({
        monthlyPrice: 59,
        yearlyDiscountLabel: '  Save 25%  ',
        yearlyPrice: 530,
      }),
    ).toBe('Save 25%');

    expect(
      getPlanYearlyDiscountLabel({
        monthlyPrice: 59,
        yearlyPrice: 590,
      }),
    ).toContain('17%');

    expect(
      getPlanYearlyDiscountLabel({
        monthlyPrice: 0,
        yearlyPrice: 590,
      }),
    ).toBe('');
  });

  it('marks missing monthly prices unavailable without reusing yearly totals', () => {
    const price = resolvePlanCyclePrice(
      {
        currency: 'USD',
        yearlyPrice: 590,
      },
      'monthly',
    );

    expect(price.amount).toBe(0);
    expect(price.isAvailable).toBe(false);
    expect(price.label).toBe('--');
    expect(price.secondaryLabel).toContain('590');
  });
});
