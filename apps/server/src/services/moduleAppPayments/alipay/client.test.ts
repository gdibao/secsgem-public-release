// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AlipayModuleAppClient } from './client';
import { signAlipayContent, signAlipayParameters } from './signature';

const merchantKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
const alipayKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

const createClient = (fetch = vi.fn()) =>
  new AlipayModuleAppClient({
    alipayPublicKey: alipayKeys.publicKey,
    appId: 'app-1',
    fetch,
    gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    merchantPrivateKey: merchantKeys.privateKey,
    sellerId: 'seller-1',
  });

const signedNotification = (overrides: Record<string, string> = {}) => {
  const parameters = {
    app_id: 'app-1',
    gmt_payment: '2026-07-12 10:00:00',
    notify_id: 'notify-1',
    out_trade_no: 'mapp_00000000000040008000000000000001',
    seller_id: 'seller-1',
    total_amount: '12.34',
    trade_no: 'trade-1',
    trade_status: 'TRADE_SUCCESS',
    ...overrides,
  };
  return new URLSearchParams({
    ...parameters,
    sign: signAlipayParameters(parameters, alipayKeys.privateKey, { excludeSignType: true }),
    sign_type: 'RSA2',
  }).toString();
};

const signedResponse = (key: string, data: Record<string, unknown>) => {
  const content = JSON.stringify(data);
  const sign = signAlipayContent(content, alipayKeys.privateKey);
  return new Response(`{"${key}":${content},"sign":"${sign}"}`, { status: 200 });
};

describe('AlipayModuleAppClient', () => {
  it('creates a signed computer website payment form', async () => {
    const result = await createClient().create({
      currency: 'CNY',
      notifyUrl: 'https://app.example.com/api/webhooks/alipay/module-app',
      orderId: '00000000-0000-4000-8000-000000000001',
      returnUrl: 'https://app.example.com/apps/order-return',
      subject: 'Module App Pro',
      totalAmount: '12.340000',
    });

    expect(result.outTradeNo).toBe('mapp_00000000000040008000000000000001');
    expect(result.checkout).toMatchObject({
      method: 'POST',
      type: 'form',
      url: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    });
    expect(result.checkout.type === 'form' && result.checkout.fields).toMatchObject({
      method: 'alipay.trade.page.pay',
      sign: expect.any(String),
    });
    expect(result.checkout.type === 'form' && result.checkout.fields).not.toHaveProperty(
      'app_cert_sn',
    );
    expect(result.checkout.type === 'form' && result.checkout.fields).not.toHaveProperty(
      'alipay_root_cert_sn',
    );
  });

  it('includes certificate serial parameters in certificate mode requests', async () => {
    const client = new AlipayModuleAppClient({
      alipayPublicKey: alipayKeys.publicKey,
      alipayRootCertSn: 'root-cert-sn-1',
      appCertSn: 'app-cert-sn-1',
      appId: 'app-1',
      gateway: 'https://openapi.alipay.com/gateway.do',
      merchantPrivateKey: merchantKeys.privateKey,
      sellerId: 'seller-1',
    } as any);

    const result = await client.create({
      currency: 'CNY',
      notifyUrl: 'https://app.example.com/api/webhooks/alipay/module-app',
      orderId: '00000000-0000-4000-8000-000000000001',
      returnUrl: 'https://app.example.com/apps/order-return',
      subject: 'Module App Pro',
      totalAmount: '12.340000',
    });

    expect(result.checkout.type === 'form' && result.checkout.fields).toMatchObject({
      alipay_root_cert_sn: 'root-cert-sn-1',
      app_cert_sn: 'app-cert-sn-1',
    });
  });

  it('rejects unsupported currencies before creating a payment form', async () => {
    await expect(
      createClient().create({
        currency: 'USD',
        notifyUrl: 'https://app.example.com/api/webhooks/alipay/module-app',
        orderId: '00000000-0000-4000-8000-000000000001',
        returnUrl: 'https://app.example.com/apps/order-return',
        subject: 'Module App Pro',
        totalAmount: '12.340000',
      }),
    ).rejects.toThrow('MODULE_APP_ALIPAY_CURRENCY_UNSUPPORTED');
  });

  it('verifies notifications and rejects wrong app or seller identities', async () => {
    const client = createClient();
    await expect(
      client.verifyNotification({ body: signedNotification(), headers: {} }),
    ).resolves.toMatchObject({
      eventId: 'notify-1',
      eventType: 'payment_succeeded',
      orderId: '00000000-0000-4000-8000-000000000001',
      totalAmount: '12.340000',
    });
    await expect(
      client.verifyNotification({ body: signedNotification({ app_id: 'wrong' }), headers: {} }),
    ).resolves.toBeNull();
    await expect(
      client.verifyNotification({ body: signedNotification({ seller_id: 'wrong' }), headers: {} }),
    ).resolves.toBeNull();
  });

  it('maps a signed full-refund notification to a refund event', async () => {
    await expect(
      createClient().verifyNotification({
        body: signedNotification({
          gmt_refund: '2026-07-12 11:00:00',
          refund_fee: '12.34',
          trade_status: 'TRADE_CLOSED',
        }),
        headers: {},
      }),
    ).resolves.toMatchObject({
      eventId: 'notify-1',
      eventType: 'refund_succeeded',
      orderId: '00000000-0000-4000-8000-000000000001',
      totalAmount: '12.340000',
    });
  });

  it('queries delayed trades, refunds, and bill download URLs through bounded fixtures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        signedResponse('alipay_trade_query_response', {
          code: '10000',
          out_trade_no: 'out-1',
          trade_status: 'WAIT_BUYER_PAY',
        }),
      )
      .mockResolvedValueOnce(
        signedResponse('alipay_trade_query_response', {
          code: '10000',
          out_trade_no: 'out-1',
          total_amount: '12.34',
          trade_no: 'trade-1',
          trade_status: 'TRADE_SUCCESS',
        }),
      )
      .mockResolvedValueOnce(
        signedResponse('alipay_trade_refund_response', {
          code: '10000',
          fund_change: 'Y',
          out_trade_no: 'out-1',
          trade_no: 'trade-1',
        }),
      )
      .mockResolvedValueOnce(
        signedResponse('alipay_data_dataservice_bill_downloadurl_query_response', {
          bill_download_url: 'https://download.example.com/bill.zip',
          code: '10000',
        }),
      )
      .mockResolvedValueOnce(
        signedResponse('alipay_trade_fastpay_refund_query_response', {
          code: '10000',
          refund_amount: '12.34',
        }),
      )
      .mockResolvedValueOnce(
        signedResponse('alipay_trade_fastpay_refund_query_response', {
          code: '40004',
          sub_code: 'ACQ.REFUND_NOT_EXIST',
        }),
      );
    const client = createClient(fetch);

    await expect(client.query({ outTradeNo: 'out-1' })).resolves.toBeNull();
    await expect(client.query({ outTradeNo: 'out-1' })).resolves.toMatchObject({
      eventType: 'payment_succeeded',
    });
    await expect(
      client.refund({
        outTradeNo: 'out-1',
        reason: 'requested',
        refundAmount: '12.340000',
        refundRequestNo: 'refund-request-1',
        totalAmount: '12.340000',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    await expect(
      client.queryBillDownloadUrl({ billDate: '2026-07-11', billType: 'trade' }),
    ).resolves.toBe('https://download.example.com/bill.zip');
    await expect(
      client.queryRefund({ outRequestNo: 'refund-1', outTradeNo: 'out-1' }),
    ).resolves.toEqual({ status: 'succeeded' });
    await expect(
      client.queryRefund({ outRequestNo: 'missing-refund', outTradeNo: 'out-1' }),
    ).resolves.toEqual({ status: 'failed' });
    const refundBody = fetch.mock.calls[2]?.[1]?.body as URLSearchParams;
    expect(JSON.parse(String(refundBody.get('biz_content')))).toMatchObject({
      out_request_no: 'refund-request-1',
    });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('keeps an accepted refund pending until Alipay confirms a fund change', async () => {
    const fetch = vi.fn().mockResolvedValue(
      signedResponse('alipay_trade_refund_response', {
        code: '10000',
        fund_change: 'N',
        out_request_no: 'refund-request-1',
        out_trade_no: 'out-1',
        trade_no: 'trade-1',
      }),
    );

    await expect(
      createClient(fetch).refund({
        outTradeNo: 'out-1',
        reason: 'requested',
        refundAmount: '12.340000',
        refundRequestNo: 'refund-request-1',
        totalAmount: '12.340000',
      }),
    ).resolves.toEqual({ providerRefundId: 'refund-request-1', status: 'pending' });
  });

  it('rejects unsigned API responses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          alipay_trade_query_response: {
            code: '10000',
            out_trade_no: 'out-1',
            total_amount: '12.34',
            trade_status: 'TRADE_SUCCESS',
          },
        }),
        { status: 200 },
      ),
    );

    await expect(createClient(fetch).query({ outTradeNo: 'out-1' })).rejects.toThrow(
      'MODULE_APP_ALIPAY_RESPONSE_SIGNATURE_INVALID',
    );
  });
});
