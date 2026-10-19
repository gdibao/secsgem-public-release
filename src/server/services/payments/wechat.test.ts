// @vitest-environment node
import { createCipheriv, generateKeyPairSync, sign as rsaSign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { WechatPayClient } from './wechat';

const merchantKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
const platformKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
const apiV3Key = '0123456789abcdef0123456789abcdef';

const signHeaders = (
  body: string,
  {
    serial = 'platform-serial-1',
    timestamp = Math.floor(Date.now() / 1000).toString(),
  }: { serial?: string; timestamp?: string } = {},
) => {
  const nonce = 'notification-nonce';
  const signature = rsaSign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    platformKeys.privateKey,
  ).toString('base64');
  return {
    'wechatpay-nonce': nonce,
    'wechatpay-serial': serial,
    'wechatpay-signature': signature,
    'wechatpay-timestamp': timestamp,
  };
};

const signedResponse = (payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  return new Response(body, { headers: signHeaders(body), status: 200 });
};

const createClient = (fetch = vi.fn()) =>
  new WechatPayClient({
    apiBaseUrl: 'https://api.mch.weixin.qq.com',
    apiV3Key,
    appId: 'wx-app-1',
    fetch,
    mchId: 'merchant-1',
    merchantPrivateKey: merchantKeys.privateKey,
    merchantSerialNo: 'merchant-serial-1',
    platformCertificate: platformKeys.publicKey,
    platformCertificateSerialNo: 'platform-serial-1',
  });

const encryptedNotification = (
  overrides: Record<string, unknown> = {},
  eventType = 'TRANSACTION.SUCCESS',
) => {
  const associatedData = 'transaction';
  const nonce = 'notification';
  const transaction = JSON.stringify({
    amount: { currency: 'CNY', total: 1234 },
    appid: 'wx-app-1',
    mchid: 'merchant-1',
    out_trade_no: 'm1234567890123456789012345678901',
    success_time: '2026-07-27T12:00:00+08:00',
    trade_state: 'SUCCESS',
    transaction_id: 'wx-trade-1',
    ...overrides,
  });
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(transaction),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const body = JSON.stringify({
    event_type: eventType,
    id: 'event-1',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      associated_data: associatedData,
      ciphertext: ciphertext.toString('base64'),
      nonce,
    },
  });
  return { body, headers: signHeaders(body) };
};

describe('WechatPayClient', () => {
  it('verifies and decrypts API v3 payment notifications', async () => {
    await expect(createClient().verifyNotification(encryptedNotification())).resolves.toMatchObject(
      {
        eventId: 'event-1',
        eventType: 'payment_succeeded',
        provider: 'wechat_pay',
        totalAmount: '12.340000',
      },
    );

    await expect(
      createClient().verifyNotification(encryptedNotification({ mchid: 'wrong-merchant' })),
    ).rejects.toThrow('WECHAT_PAY_NOTIFICATION_MERCHANT_MISMATCH');
  });

  it('verifies and decrypts API v3 refund notifications without requiring an app id', async () => {
    const notification = encryptedNotification(
      {
        amount: { currency: 'CNY', refund: 1234, total: 1234 },
        appid: undefined,
        out_refund_no: 'refund-request-1',
        refund_id: 'wechat-refund-1',
        refund_status: 'SUCCESS',
        trade_state: undefined,
      },
      'REFUND.SUCCESS',
    );

    await expect(createClient().verifyNotification(notification)).resolves.toMatchObject({
      eventId: 'event-1',
      eventType: 'refund_succeeded',
      paymentReference: 'wechat-refund-1',
      provider: 'wechat_pay',
      totalAmount: '12.340000',
    });
  });

  it('rejects stale callbacks and signatures from another platform certificate', async () => {
    const stale = encryptedNotification();
    stale.headers = signHeaders(stale.body, {
      timestamp: Math.floor(Date.now() / 1000 - 301).toString(),
    });
    await expect(createClient().verifyNotification(stale)).rejects.toThrow(
      'WECHAT_PAY_RESPONSE_TIMESTAMP_STALE',
    );

    const wrongCertificate = encryptedNotification();
    wrongCertificate.headers = signHeaders(wrongCertificate.body, { serial: 'another-serial' });
    await expect(createClient().verifyNotification(wrongCertificate)).rejects.toThrow(
      'WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL_MISMATCH',
    );
  });

  it('creates Native Pay QR checkout and keeps refund total separate from refund amount', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(signedResponse({ code_url: 'weixin://wxpay/example' }))
      .mockResolvedValueOnce(signedResponse({ status: 'PROCESSING' }))
      .mockResolvedValueOnce(signedResponse({ status: 'ABNORMAL' }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const client = createClient(fetch);

    await expect(
      client.create({
        currency: 'CNY',
        notifyUrl: 'https://app.example.com/api/webhooks/payments/wechat_pay',
        orderId: '00000000-0000-4000-8000-000000000001',
        purpose: 'module_app',
        returnUrl: 'https://app.example.com/apps',
        subject: 'Module App Pro',
        totalAmount: '12.340000',
      }),
    ).resolves.toMatchObject({
      checkout: { type: 'qrcode', url: 'weixin://wxpay/example' },
      method: 'wechat_pay',
    });
    await expect(
      client.refund({
        outTradeNo: 'm1234567890123456789012345678901',
        reason: 'requested',
        refundAmount: '5.000000',
        refundRequestNo: 'wr-request-1',
        totalAmount: '12.340000',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      client.queryRefund({
        outRequestNo: 'refund-1',
        outTradeNo: 'm1234567890123456789012345678901',
      }),
    ).resolves.toEqual({ status: 'failed' });
    await expect(
      client.queryRefund({
        outRequestNo: 'missing-refund',
        outTradeNo: 'm1234567890123456789012345678901',
      }),
    ).resolves.toEqual({ status: 'failed' });

    const refundRequest = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(refundRequest.body))).toMatchObject({
      amount: { currency: 'CNY', refund: 500, total: 1234 },
      out_refund_no: 'wr-request-1',
    });
  });
});
