import { Plans } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  clearSubscriptionPaymentIntent,
  getOrCreateSubscriptionPaymentIntent,
  readSubscriptionPaymentIntent,
  type SubscriptionPaymentIntentStorage,
} from './subscriptionIntent';

const INTENT_1 = '00000000-0000-4000-8000-000000000021';
const INTENT_2 = '00000000-0000-4000-8000-000000000022';

const createStorage = (): SubscriptionPaymentIntentStorage => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe('subscription payment intent', () => {
  it('reuses only an intent with the same plan, cycle, and method', () => {
    const storage = createStorage();
    const createId = vi.fn().mockReturnValueOnce(INTENT_1).mockReturnValueOnce(INTENT_2);
    const selection = { cycle: 'yearly' as const, method: 'alipay' as const, plan: Plans.Starter };

    const first = getOrCreateSubscriptionPaymentIntent(selection, { createId, storage });
    expect(getOrCreateSubscriptionPaymentIntent(selection, { createId, storage })).toEqual(first);
    const changed = getOrCreateSubscriptionPaymentIntent(
      { ...selection, cycle: 'monthly' },
      { createId, storage },
    );

    expect(changed.idempotencyKey).toBe(INTENT_2);
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it('rejects a stored intent whose plan is not a supported Plans value', () => {
    const storage = createStorage();
    storage.setItem(
      'comhub.subscription.payment-intent.v1',
      JSON.stringify({
        cycle: 'monthly',
        idempotencyKey: INTENT_1,
        method: 'alipay',
        plan: 'enterprise-injected',
      }),
    );

    expect(readSubscriptionPaymentIntent(storage)).toBeUndefined();
    expect(storage.getItem('comhub.subscription.payment-intent.v1')).toBeNull();
  });

  it('clears only the matching intent', () => {
    const storage = createStorage();
    const intent = getOrCreateSubscriptionPaymentIntent(
      { cycle: 'lifetime', method: 'wechat_pay', plan: Plans.Premium },
      { createId: () => INTENT_1, storage },
    );

    clearSubscriptionPaymentIntent(INTENT_2, storage);
    expect(readSubscriptionPaymentIntent(storage)).toEqual(intent);
    clearSubscriptionPaymentIntent(INTENT_1, storage);
    expect(readSubscriptionPaymentIntent(storage)).toBeUndefined();
  });
});
