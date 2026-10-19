// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createPaymentWebhookHandler } from './route';

const context = (provider: string) => ({ params: Promise.resolve({ provider }) });

describe('payment webhook route', () => {
  it('returns provider-specific success responses', async () => {
    const handle = vi.fn().mockResolvedValue({ status: 'paid' });
    const handler = createPaymentWebhookHandler({ handle });

    const response = await handler(
      new Request('https://app.example.com/api/webhooks/payments/alipay', {
        body: 'signed=payload',
        method: 'POST',
      }),
      context('alipay'),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'signed=payload', provider: 'alipay' }),
    );
  });

  it('returns the WeChat API v3 failure contract', async () => {
    const onError = vi.fn();
    const error = new Error('invalid signature');
    const handler = createPaymentWebhookHandler({
      handle: vi.fn().mockRejectedValue(error),
      onError,
    });

    const response = await handler(
      new Request('https://app.example.com/api/webhooks/payments/wechat_pay', {
        body: '{}',
        method: 'POST',
      }),
      context('wechat_pay'),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'FAIL', message: '处理失败' });
    expect(onError).toHaveBeenCalledWith(error, {
      method: 'POST',
      provider: 'wechat_pay',
    });
  });

  it('allows Z-Pay GET callbacks but rejects GET for direct providers', async () => {
    const handle = vi.fn().mockResolvedValue({ status: 'paid' });
    const handler = createPaymentWebhookHandler({ handle });
    const zpayResponse = await handler(
      new Request('https://app.example.com/api/webhooks/payments/zpay?pid=merchant&type=alipay'),
      context('zpay'),
    );
    expect(zpayResponse.status).toBe(200);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'pid=merchant&type=alipay', provider: 'zpay' }),
    );

    const alipayResponse = await handler(
      new Request('https://app.example.com/api/webhooks/payments/alipay?sign=value'),
      context('alipay'),
    );
    expect(alipayResponse.status).toBe(405);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized notifications before invoking payment logic', async () => {
    const handle = vi.fn();
    const handler = createPaymentWebhookHandler({ handle });
    const response = await handler(
      new Request('https://app.example.com/api/webhooks/payments/alipay', {
        body: 'small',
        headers: { 'content-length': String(300 * 1024) },
        method: 'POST',
      }),
      context('alipay'),
    );

    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });
});
