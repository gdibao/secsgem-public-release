import { describe, expect, it } from 'vitest';

import {
  ADMIN_SUBSCRIPTION_CYCLES,
  getAdminSubscriptionCycleLabel,
  isFiniteAdminSubscriptionCycle,
} from './adminSubscriptionCycles';

describe('admin subscription cycles', () => {
  it('keeps admin plan operations aligned with every supported subscription cycle', () => {
    expect(ADMIN_SUBSCRIPTION_CYCLES).toEqual(['monthly', 'yearly', 'one_time', 'lifetime']);
  });

  it('labels the non-recurring cycles used by admin select controls', () => {
    expect(getAdminSubscriptionCycleLabel('one_time')).toBe('一次性');
    expect(getAdminSubscriptionCycleLabel('lifetime')).toBe('终身');
  });

  it('treats lifetime grants as duration-free', () => {
    expect(isFiniteAdminSubscriptionCycle('monthly')).toBe(true);
    expect(isFiniteAdminSubscriptionCycle('yearly')).toBe(true);
    expect(isFiniteAdminSubscriptionCycle('one_time')).toBe(true);
    expect(isFiniteAdminSubscriptionCycle('lifetime')).toBe(false);
  });
});
