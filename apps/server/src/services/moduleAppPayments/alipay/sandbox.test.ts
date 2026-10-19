// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { AlipayModuleAppClient } from './client';

const certificateMode = process.env.MODULE_APP_ALIPAY_CERT_MODE === 'certificate';
const requiredKeys = [
  'MODULE_APP_ALIPAY_APP_ID',
  'MODULE_APP_ALIPAY_SELLER_ID',
  'MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY',
  ...(certificateMode
    ? [
        'MODULE_APP_ALIPAY_CERTIFICATE',
        'MODULE_APP_ALIPAY_APP_CERT_SN',
        'MODULE_APP_ALIPAY_ROOT_CERT_SN',
      ]
    : ['MODULE_APP_ALIPAY_PUBLIC_KEY']),
  'MODULE_APP_ALIPAY_RETURN_URL',
  'MODULE_APP_ALIPAY_NOTIFY_URL',
];
const sandboxEnabled = process.env.MODULE_APP_ALIPAY_SANDBOX_TESTS === 'true';
const productionGatesRequired = process.env.MODULE_APP_PRODUCTION_GATES_REQUIRED === 'true';
const missing = requiredKeys.filter((key) => !process.env[key]?.trim());

if (productionGatesRequired && (!sandboxEnabled || missing.length > 0)) {
  throw new Error(
    `MODULE_APP_ALIPAY_SANDBOX_REQUIRED:${missing.join(',') || 'MODULE_APP_ALIPAY_SANDBOX_TESTS'}`,
  );
}

const createClient = () =>
  new AlipayModuleAppClient({
    alipayPublicKey: (certificateMode
      ? process.env.MODULE_APP_ALIPAY_CERTIFICATE!
      : process.env.MODULE_APP_ALIPAY_PUBLIC_KEY!
    ).replaceAll('\\n', '\n'),
    ...(certificateMode
      ? {
          alipayRootCertSn: process.env.MODULE_APP_ALIPAY_ROOT_CERT_SN!,
          appCertSn: process.env.MODULE_APP_ALIPAY_APP_CERT_SN!,
        }
      : {}),
    appId: process.env.MODULE_APP_ALIPAY_APP_ID!,
    gateway:
      process.env.MODULE_APP_ALIPAY_GATEWAY ??
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    merchantPrivateKey: process.env.MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY!.replaceAll('\\n', '\n'),
    sellerId: process.env.MODULE_APP_ALIPAY_SELLER_ID!,
    timeoutMs: 15_000,
  });

describe.skipIf(!sandboxEnabled || missing.length > 0)('Alipay Module App sandbox', () => {
  it('creates a signed computer website payment form from server values', async () => {
    const client = createClient();
    const result = await client.create({
      currency: 'CNY',
      notifyUrl: process.env.MODULE_APP_ALIPAY_NOTIFY_URL!,
      orderId: crypto.randomUUID(),
      returnUrl: process.env.MODULE_APP_ALIPAY_RETURN_URL!,
      subject: 'ComHub Module App sandbox verification',
      totalAmount: '0.010000',
    });

    if (result.checkout.type !== 'form') throw new Error('Expected an Alipay form checkout');
    expect(result.checkout.fields.method).toBe('alipay.trade.page.pay');
    expect(result.checkout.fields.biz_content).toContain('FAST_INSTANT_TRADE_PAY');
    expect(result.checkout.fields.sign).toBeTruthy();
  });

  it('accepts a signed sandbox query response for a unique absent trade', async () => {
    const client = createClient();
    const outTradeNo = `mapp_probe_${Date.now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

    await expect(client.query({ outTradeNo })).resolves.toBeNull();
  });
});
