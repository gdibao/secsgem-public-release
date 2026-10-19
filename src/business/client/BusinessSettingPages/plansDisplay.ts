import { Plans } from '@lobechat/types';

export const PLAN_DISPLAY_CURRENCY = 'USD';

export type PlanDisplayBillingCycle = 'lifetime' | 'monthly' | 'one_time' | 'yearly';

export type PlanPriceCatalogLike = {
  currency?: null | string;
  lifetimePrice?: null | number;
  monthlyPrice?: null | number;
  oneTimePrice?: null | number;
  yearlyDiscountLabel?: null | string;
  yearlyPrice?: null | number;
};

export type PlanCyclePrice = {
  amount: number;
  currency: string;
  cycle: PlanDisplayBillingCycle;
  discountPercent: number;
  isAvailable: boolean;
  label: string;
  monthlyEquivalent?: number;
  secondaryLabel?: string;
  unit: string;
};

export const getVisiblePaidPlans = <T extends string>(plans: readonly T[]) =>
  plans.filter((plan) => plan !== Plans.Free);

export const getConfiguredVisiblePaidPlans = <T extends string>(
  planOrder: readonly T[],
  configuredPlans: readonly T[] | null | undefined,
) => getVisiblePaidPlans(planOrder.filter((plan) => configuredPlans?.includes(plan) ?? false));

export const getDefaultMobilePlanTarget = (
  visiblePlans: Plans[],
  currentPlan: Plans,
  isAvailable: (plan: Plans) => boolean,
) => visiblePlans.find((plan) => plan !== currentPlan && isAvailable(plan));

const hasPositivePrice = (value: unknown) => Number(value ?? 0) > 0;

export const getAvailableBillingCycles = (
  planCatalog: Array<PlanPriceCatalogLike> | null | undefined,
): PlanDisplayBillingCycle[] => {
  const plans = planCatalog ?? [];
  const hasYearly = plans.some((item) => hasPositivePrice(item.yearlyPrice));
  const hasMonthly = plans.some((item) => hasPositivePrice(item.monthlyPrice));
  const cycles: PlanDisplayBillingCycle[] = [];

  if (hasYearly) cycles.push('yearly');
  if (hasMonthly) cycles.push('monthly');
  if (plans.some((item) => hasPositivePrice(item.oneTimePrice))) cycles.push('one_time');
  if (plans.some((item) => hasPositivePrice(item.lifetimePrice))) cycles.push('lifetime');

  return cycles;
};

const normalizeCurrency = (currency?: null | string) =>
  (currency?.trim() || PLAN_DISPLAY_CURRENCY).toUpperCase();

export const formatPlanCurrencyAmount = (value: number, currency?: null | string) => {
  const resolvedCurrency = normalizeCurrency(currency);

  try {
    return new Intl.NumberFormat('zh-CN', {
      currency: resolvedCurrency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      style: 'currency',
    }).format(value);
  } catch {
    return `${resolvedCurrency} ${value}`;
  }
};

export const getPlanYearlyDiscountPercent = (monthlyPrice: number, yearlyPrice: number) => {
  if (monthlyPrice <= 0 || yearlyPrice <= 0) return 0;

  return Math.max(0, Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100));
};

export const getPlanYearlyDiscountLabel = (
  catalogPlan: PlanPriceCatalogLike | null | undefined,
) => {
  const configuredLabel = catalogPlan?.yearlyDiscountLabel?.trim();
  if (configuredLabel) return configuredLabel;

  const discountPercent = getPlanYearlyDiscountPercent(
    Number(catalogPlan?.monthlyPrice ?? 0),
    Number(catalogPlan?.yearlyPrice ?? 0),
  );

  return discountPercent > 0 ? `优惠 ${discountPercent}%` : '';
};

export const getYearlyCycleDiscountLabel = (
  planCatalog: Array<PlanPriceCatalogLike> | null | undefined,
) => {
  const configuredLabel = planCatalog?.find((item) =>
    item.yearlyDiscountLabel?.trim(),
  )?.yearlyDiscountLabel;
  if (configuredLabel?.trim()) return configuredLabel.trim();

  const maxDiscount = (planCatalog ?? []).reduce(
    (max, item) =>
      Math.max(
        max,
        getPlanYearlyDiscountPercent(Number(item.monthlyPrice ?? 0), Number(item.yearlyPrice ?? 0)),
      ),
    0,
  );

  return maxDiscount > 0 ? `最高优惠 ${maxDiscount}%` : '';
};

export const resolvePlanCyclePrice = (
  catalogPlan: PlanPriceCatalogLike | null | undefined,
  cycle: PlanDisplayBillingCycle,
): PlanCyclePrice => {
  const currency = normalizeCurrency(catalogPlan?.currency);
  const lifetimePrice = Number(catalogPlan?.lifetimePrice ?? 0);
  const monthlyPrice = Number(catalogPlan?.monthlyPrice ?? 0);
  const oneTimePrice = Number(catalogPlan?.oneTimePrice ?? 0);
  const yearlyPrice = Number(catalogPlan?.yearlyPrice ?? 0);
  const discountPercent = getPlanYearlyDiscountPercent(monthlyPrice, yearlyPrice);

  const build = ({
    amount,
    label,
    monthlyEquivalent,
    secondaryLabel,
    unit,
  }: {
    amount: number;
    label?: string;
    monthlyEquivalent?: number;
    secondaryLabel?: string;
    unit: string;
  }): PlanCyclePrice => ({
    amount,
    currency,
    cycle,
    discountPercent,
    isAvailable: amount > 0,
    label: amount > 0 ? label || formatPlanCurrencyAmount(amount, currency) : '--',
    ...(monthlyEquivalent === undefined ? {} : { monthlyEquivalent }),
    ...(secondaryLabel === undefined ? {} : { secondaryLabel }),
    unit,
  });

  switch (cycle) {
    case 'yearly': {
      const monthlyEquivalent = yearlyPrice > 0 ? yearlyPrice / 12 : undefined;
      return build({
        amount: yearlyPrice,
        ...(monthlyEquivalent === undefined
          ? {}
          : {
              label: formatPlanCurrencyAmount(monthlyEquivalent, currency),
              monthlyEquivalent,
            }),
        secondaryLabel:
          yearlyPrice > 0
            ? `${formatPlanCurrencyAmount(yearlyPrice, currency)} / 每年${
                discountPercent > 0 ? `，优惠 ${discountPercent}%` : ''
              }`
            : '暂未配置年付价格',
        unit: '每月',
      });
    }

    case 'one_time': {
      return build({
        amount: oneTimePrice,
        secondaryLabel: oneTimePrice > 0 ? '一次性支付' : '暂未配置一次性价格',
        unit: '一次性',
      });
    }

    case 'lifetime': {
      return build({
        amount: lifetimePrice,
        secondaryLabel: lifetimePrice > 0 ? '终身权益价格' : '暂未配置终身价格',
        unit: '终身',
      });
    }

    default: {
      return build({
        amount: monthlyPrice,
        ...(yearlyPrice > 0
          ? {
              secondaryLabel: `${formatPlanCurrencyAmount(yearlyPrice, currency)} / 每年${
                discountPercent > 0 ? `，年付优惠 ${discountPercent}%` : ''
              }`,
            }
          : {}),
        unit: '每月',
      });
    }
  }
};
