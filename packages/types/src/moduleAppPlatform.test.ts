import { describe, expect, it } from 'vitest';

import {
  moduleAppAiChatInputSchema,
  moduleAppPaymentCheckoutInputSchema,
  moduleAppPaymentCheckoutResultSchema,
} from './moduleAppPlatform';

describe('module app platform gateway contracts', () => {
  it('accepts bounded chat input without exposing a provider credential field', () => {
    expect(
      moduleAppAiChatInputSchema.parse({
        maxTokens: 1024,
        messages: [
          { content: 'You are concise.', role: 'system' },
          { content: 'Summarize this.', role: 'user' },
        ],
        model: 'gpt-4.1-mini',
        temperature: 0.4,
      }),
    ).toMatchObject({ model: 'gpt-4.1-mini' });

    expect(() =>
      moduleAppAiChatInputSchema.parse({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'gpt-4.1-mini',
        provider: 'newapi',
      }),
    ).toThrow();
  });

  it('requires a platform-generated idempotency key for payment checkout', () => {
    expect(() =>
      moduleAppPaymentCheckoutInputSchema.parse({
        productId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow();

    expect(
      moduleAppPaymentCheckoutInputSchema.parse({
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
        method: 'zpay_wechat',
        productId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toMatchObject({ method: 'zpay_wechat' });
  });

  it('keeps checkout output limited to the user-facing payment action', () => {
    expect(
      moduleAppPaymentCheckoutResultSchema.parse({
        checkout: { type: 'redirect', url: 'https://pay.example.com/checkout' },
        method: 'wechat_pay',
        orderId: '00000000-0000-4000-8000-000000000003',
        outTradeNo: 'module-app-order-1',
        provider: 'wechat_pay',
      }),
    ).toMatchObject({ provider: 'wechat_pay' });

    expect(() =>
      moduleAppPaymentCheckoutResultSchema.parse({
        checkout: { type: 'redirect', url: 'https://pay.example.com/checkout' },
        merchantKey: 'must-not-leak',
        method: 'wechat_pay',
        orderId: '00000000-0000-4000-8000-000000000003',
        outTradeNo: 'module-app-order-1',
        provider: 'wechat_pay',
      }),
    ).toThrow();
  });
});
