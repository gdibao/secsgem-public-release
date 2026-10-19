import { describe, expect, it, vi } from 'vitest';

import {
  clearTopUpPaymentIntent,
  getOrCreateTopUpPaymentIntent,
  readTopUpPaymentIntent,
  type TopUpPaymentIntentStorage,
} from './paymentIntent';

const INTENT_1 = '00000000-0000-4000-8000-000000000011';
const INTENT_2 = '00000000-0000-4000-8000-000000000012';

const createStorage = (): TopUpPaymentIntentStorage => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe('top-up payment intent', () => {
  it('reuses the idempotency key for the same payment selection', () => {
    const storage = createStorage();
    const createId = vi.fn(() => INTENT_1);
    const selection = { method: 'wechat_pay' as const, packageId: 'package-1' };

    const first = getOrCreateTopUpPaymentIntent(selection, { createId, storage });
    const second = getOrCreateTopUpPaymentIntent(selection, { createId, storage });

    expect(second).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it('rotates the idempotency key when the payment selection changes', () => {
    const storage = createStorage();
    const createId = vi.fn().mockReturnValueOnce(INTENT_1).mockReturnValueOnce(INTENT_2);

    getOrCreateTopUpPaymentIntent(
      { method: 'wechat_pay', packageId: 'package-1' },
      { createId, storage },
    );
    const changed = getOrCreateTopUpPaymentIntent(
      { method: 'alipay', packageId: 'package-1' },
      { createId, storage },
    );

    expect(changed.idempotencyKey).toBe(INTENT_2);
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it('restores the stored selection and clears only the matching intent', () => {
    const storage = createStorage();
    const intent = getOrCreateTopUpPaymentIntent(
      { method: 'zpay_alipay', packageId: 'package-2' },
      { createId: () => INTENT_1, storage },
    );

    expect(readTopUpPaymentIntent(storage)).toEqual(intent);
    clearTopUpPaymentIntent(INTENT_2, storage);
    expect(readTopUpPaymentIntent(storage)).toEqual(intent);
    clearTopUpPaymentIntent(intent.idempotencyKey, storage);
    expect(readTopUpPaymentIntent(storage)).toBeUndefined();
  });
});
