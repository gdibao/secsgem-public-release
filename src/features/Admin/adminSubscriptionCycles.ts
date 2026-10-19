import type { SubscriptionCycleType } from '@/types/business';

export const ADMIN_SUBSCRIPTION_CYCLES = [
  'monthly',
  'yearly',
  'one_time',
  'lifetime',
] as const satisfies readonly SubscriptionCycleType[];

export type AdminSubscriptionCycle = (typeof ADMIN_SUBSCRIPTION_CYCLES)[number];

export const getAdminSubscriptionCycleLabel = (cycle: AdminSubscriptionCycle) => {
  switch (cycle) {
    case 'yearly': {
      return '年付';
    }
    case 'one_time': {
      return '一次性';
    }
    case 'lifetime': {
      return '终身';
    }
    default: {
      return '月付';
    }
  }
};

export const isFiniteAdminSubscriptionCycle = (cycle: AdminSubscriptionCycle) =>
  cycle !== 'lifetime';