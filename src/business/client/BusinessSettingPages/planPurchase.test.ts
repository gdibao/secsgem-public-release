import { describe, expect, it } from 'vitest';

import { getPlanPurchaseUrl, resolvePlanPurchaseAction } from './planPurchase';

describe('getPlanPurchaseUrl', () => {
  it('returns trimmed http purchase links', () => {
    expect(getPlanPurchaseUrl({ purchaseUrl: ' https://pay.example.com/plan ' })).toBe(
      'https://pay.example.com/plan',
    );
  });

  it('ignores non-http links', () => {
    expect(getPlanPurchaseUrl({ purchaseUrl: 'javascript:alert(1)' })).toBeNull();
    expect(getPlanPurchaseUrl({ purchaseUrl: '/checkout' })).toBeNull();
  });
});

describe('resolvePlanPurchaseAction', () => {
  it('prefers the integrated checkout when an online method is available', () => {
    expect(
      resolvePlanPurchaseAction({
        hasOnlinePaymentMethods: true,
        plan: { purchaseUrl: 'https://pay.example.com/legacy' },
      }),
    ).toEqual({ type: 'checkout' });
  });

  it('uses the configured external URL only when integrated checkout is unavailable', () => {
    expect(
      resolvePlanPurchaseAction({
        hasOnlinePaymentMethods: false,
        plan: { purchaseUrl: 'https://pay.example.com/legacy' },
      }),
    ).toEqual({ type: 'external', url: 'https://pay.example.com/legacy' });
    expect(resolvePlanPurchaseAction({ hasOnlinePaymentMethods: false })).toEqual({
      type: 'unavailable',
    });
  });
});
