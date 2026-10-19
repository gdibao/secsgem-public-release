// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { signZPayParameters, ZPayClient } from './zpay';

const createClient = (fetch = vi.fn(), method: 'zpay_alipay' | 'zpay_wechat' = 'zpay_alipay') =>
  new ZPayClient({
    apiBaseUrl: 'https://zpayz.cn',
    fetch,
    merchantId: 'merchant-1',
    merchantKey: 'merchant-secret',
    method,
  });

describe('ZPayClient', () => {
  it('uses the documented sorted MD5 signature', () => {
    const expected = createHash('md5').update('a=1&b=2merchant-secret', 'utf8').digest('hex');

    expect(
      signZPayParameters(
        { a: '1', b: '2', empty: '', sign: 'ignored', sign_type: 'MD5' },
        'merchant-secret',
      ),
    ).toBe(expected);
  });

  it('creates a signed page-payment form with a protocol-compliant order number', async () => {
    const result = await createClient().create({
      currency: 'CNY',
      notifyUrl: 'https://app.example.com/api/webhooks/payments/zpay',
      orderId: '00000000-0000-4000-8000-000000000001',
      purpose: 'top_up',
      returnUrl: 'https://app.example.com/topup',
      subject: 'ComHub credits',
      totalAmount: '12.340000',
    });

    expect(result.outTradeNo).toHaveLength(32);
    expect(result).toMatchObject({ method: 'zpay_alipay', provider: 'zpay' });
    expect(result.checkout).toMatchObject({
      fields: expect.objectContaining({
        money: '12.34',
        pid: 'merchant-1',
        sign: expect.any(String),
        sign_type: 'MD5',
        type: 'alipay',
      }),
      method: 'POST',
      type: 'form',
      url: 'https://zpayz.cn/submit.php',
    });
  });

  it('verifies callback identity, signature, and selected sub-channel', async () => {
    const parameters: Record<string, string> = {
      money: '12.34',
      out_trade_no: 'tza12345678901234567890123456789',
      pid: 'merchant-1',
      trade_no: 'trade-1',
      trade_status: 'TRADE_SUCCESS',
      type: 'alipay',
    };
    parameters.sign = signZPayParameters(parameters, 'merchant-secret');
    parameters.sign_type = 'MD5';

    await expect(
      createClient().verifyNotification({
        body: new URLSearchParams(parameters).toString(),
        headers: {},
      }),
    ).resolves.toMatchObject({
      eventType: 'payment_succeeded',
      provider: 'zpay',
      totalAmount: '12.340000',
    });

    const wrongMethod: Record<string, string> = { ...parameters, type: 'wxpay' };
    wrongMethod.sign = signZPayParameters(wrongMethod, 'merchant-secret');
    await expect(
      createClient().verifyNotification({
        body: new URLSearchParams(wrongMethod).toString(),
        headers: {},
      }),
    ).rejects.toThrow('ZPAY_NOTIFICATION_METHOD_MISMATCH');
  });

  it('queries orders with GET and submits refunds with POST', async () => {
    const outTradeNo = 'tza12345678901234567890123456789';
    const paidOrder = {
      code: 1,
      money: '12.34',
      out_trade_no: outTradeNo,
      pid: 'merchant-1',
      status: 1,
      trade_no: 'trade-1',
      type: 'alipay',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(paidOrder))
      .mockResolvedValueOnce(Response.json(paidOrder))
      .mockResolvedValueOnce(Response.json({ code: 1, msg: 'success' }));
    const client = createClient(fetch);

    await expect(client.query({ outTradeNo })).resolves.toMatchObject({
      eventType: 'payment_succeeded',
    });
    await expect(
      client.refund({
        outTradeNo,
        reason: 'requested',
        refundAmount: '5.000000',
        refundRequestNo: 'zr-request-1',
        totalAmount: '12.340000',
      }),
    ).resolves.toMatchObject({ providerRefundId: 'zr-request-1', status: 'succeeded' });

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
    const refundUrl = fetch.mock.calls[2]?.[0] as URL;
    const refundRequest = fetch.mock.calls[2]?.[1] as RequestInit;
    expect(refundUrl.searchParams.has('key')).toBe(false);
    expect(refundRequest.method).toBe('POST');
    expect(String(refundRequest.body)).toContain('money=5.00');
    expect(String(refundRequest.body)).toContain('key=merchant-secret');
  });

  it('keeps a refund pending when the POST result is unknown', async () => {
    const outTradeNo = 'tza12345678901234567890123456789';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          code: 1,
          money: '12.34',
          out_trade_no: outTradeNo,
          pid: 'merchant-1',
          status: 1,
          trade_no: 'trade-1',
          type: 'alipay',
        }),
      )
      .mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));

    await expect(
      createClient(fetch).refund({
        outTradeNo,
        reason: 'requested',
        refundAmount: '5.000000',
        refundRequestNo: 'zr-request-unknown',
        totalAmount: '12.340000',
      }),
    ).resolves.toEqual({ providerRefundId: 'zr-request-unknown', status: 'pending' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['order identity', { out_trade_no: 'another-order' }, 'ZPAY_QUERY_ORDER_MISMATCH'],
    ['sub-channel', { type: 'wxpay' }, 'ZPAY_QUERY_METHOD_MISMATCH'],
    ['original amount', { money: '12.35' }, 'ZPAY_REFUND_TOTAL_AMOUNT_MISMATCH'],
  ])('rejects refunds with a mismatched %s', async (_case, overrides, errorCode) => {
    const outTradeNo = 'tza12345678901234567890123456789';
    const fetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        code: 1,
        money: '12.34',
        out_trade_no: outTradeNo,
        pid: 'merchant-1',
        status: 1,
        trade_no: 'trade-1',
        type: 'alipay',
        ...overrides,
      }),
    );

    await expect(
      createClient(fetch).refund({
        outTradeNo,
        reason: 'requested',
        refundAmount: '5.000000',
        totalAmount: '12.340000',
      }),
    ).rejects.toThrow(errorCode);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
