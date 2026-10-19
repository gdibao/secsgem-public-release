import { describe, expect, it } from 'vitest';

import {
  moduleAppNormalizedPaymentEventSchema,
  moduleAppPaymentProviderSchema,
} from './moduleAppPayment';

describe('module app payment contracts', () => {
  it('accepts bounded normalized Alipay events with decimal string amounts', () => {
    expect(moduleAppNormalizedPaymentEventSchema.parse({
      currency: 'CNY',
      eventId: 'notify-1',
      eventType: 'payment_succeeded',
      occurredAt: '2026-07-12T00:00:00.000Z',
      outTradeNo: 'module-app-order-1',
      provider: 'alipay',
      providerTransactionId: 'trade-1',
      totalAmount: '12.340000',
    })).toMatchObject({ provider: 'alipay', totalAmount: '12.340000' });
  });

  it('rejects non-Alipay providers and unsafe money values', () => {
    expect(moduleAppPaymentProviderSchema.safeParse('wechat').success).toBe(false);
    expect(moduleAppNormalizedPaymentEventSchema.safeParse({
      currency: 'CNY',
      eventId: 'notify-1',
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: 'module-app-order-1',
      provider: 'alipay',
      totalAmount: 12.34,
    }).success).toBe(false);
  });
});
