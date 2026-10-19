import { createHash, timingSafeEqual } from 'node:crypto';

import type { ModuleAppPaymentAdapter } from '@/business/server/module-apps/payments/contracts';

import { parseCnyPaymentAmount } from './amount';

type FetchLike = typeof fetch;

export type ZPayClientOptions = {
  apiBaseUrl: string;
  fetch?: FetchLike;
  merchantId: string;
  merchantKey: string;
  method: 'zpay_alipay' | 'zpay_wechat';
  timeoutMs?: number;
};

const normalizeAmount = (value: unknown) => {
  return `${parseCnyPaymentAmount(String(value)).decimal}0000`;
};

const equalSignature = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual.toLowerCase());
  const expectedBuffer = Buffer.from(expected.toLowerCase());
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

export const signZPayParameters = (
  parameters: Record<string, string | undefined>,
  merchantKey: string,
) => {
  const canonical = Object.entries(parameters)
    .filter(
      ([key, value]) =>
        key !== 'sign' && key !== 'sign_type' && value !== undefined && value !== '',
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('md5').update(`${canonical}${merchantKey}`, 'utf8').digest('hex');
};

const parseResponse = async (response: Response) => {
  if (!response.ok) throw new Error(`ZPAY_HTTP_${response.status}`);
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('ZPAY_RESPONSE_INVALID');
  }
  return payload as Record<string, unknown>;
};

export class ZPayClient implements ModuleAppPaymentAdapter {
  readonly provider = 'zpay' as const;
  readonly method: 'zpay_alipay' | 'zpay_wechat';
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: ZPayClientOptions) {
    this.method = options.method;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
    new URL(options.apiBaseUrl);
    if (!options.merchantId.trim() || !options.merchantKey.trim()) {
      throw new Error('ZPAY_CONFIGURATION_REQUIRED');
    }
  }

  createOutTradeNo: ModuleAppPaymentAdapter['createOutTradeNo'] = ({ orderId, purpose }) => {
    const prefix = this.method === 'zpay_alipay' ? 'za' : 'zw';
    const purposePrefix = purpose === 'module_app' ? 'm' : purpose === 'subscription' ? 's' : 't';
    return `${purposePrefix}${prefix}${createHash('sha256')
      .update(`${purpose}:${orderId}`)
      .digest('hex')
      .slice(0, 29)}`;
  };

  createRefundRequestNo: ModuleAppPaymentAdapter['createRefundRequestNo'] = (input) =>
    `zr${createHash('sha256')
      .update(`${input.outTradeNo}:${input.refundAmount}`)
      .digest('hex')
      .slice(0, 30)}`;

  create: ModuleAppPaymentAdapter['create'] = async (input) => {
    if (input.currency !== 'CNY') throw new Error('ZPAY_CURRENCY_UNSUPPORTED');
    const outTradeNo = this.createOutTradeNo({
      orderId: input.orderId,
      purpose: input.purpose ?? 'module_app',
    });
    const amount = parseCnyPaymentAmount(input.totalAmount);
    const fields: Record<string, string> = {
      money: amount.decimal,
      name: input.subject,
      notify_url: input.notifyUrl,
      out_trade_no: outTradeNo,
      pid: this.options.merchantId,
      return_url: input.returnUrl,
      type: this.method === 'zpay_alipay' ? 'alipay' : 'wxpay',
    };
    fields.sign = signZPayParameters(fields, this.options.merchantKey);
    fields.sign_type = 'MD5';

    return {
      checkout: {
        fields,
        method: 'POST',
        type: 'form',
        url: new URL('/submit.php', this.options.apiBaseUrl).toString(),
      },
      method: this.method,
      outTradeNo,
      provider: this.provider,
    };
  };

  query: ModuleAppPaymentAdapter['query'] = async ({ outTradeNo }) => {
    const payload = await this.queryOrder(outTradeNo);
    if (Number(payload.code) !== 1) throw new Error('ZPAY_QUERY_FAILED');
    if (Number(payload.status) !== 1) return null;
    if (payload.out_trade_no !== outTradeNo) throw new Error('ZPAY_QUERY_ORDER_MISMATCH');
    const expectedType = this.method === 'zpay_alipay' ? 'alipay' : 'wxpay';
    if (payload.type !== expectedType) throw new Error('ZPAY_QUERY_METHOD_MISMATCH');
    if (String(payload.pid ?? '') !== this.options.merchantId) {
      throw new Error('ZPAY_QUERY_MERCHANT_MISMATCH');
    }
    const tradeNo = typeof payload.trade_no === 'string' ? payload.trade_no : undefined;
    const totalAmount = normalizeAmount(payload.money);
    return {
      currency: 'CNY',
      eventId: `query:${outTradeNo}:${tradeNo ?? 'paid'}`,
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo,
      paymentReference: tradeNo,
      provider: this.provider,
      providerTransactionId: tradeNo,
      totalAmount,
    };
  };

  refund: ModuleAppPaymentAdapter['refund'] = async (input) => {
    const order = await this.queryOrder(input.outTradeNo);
    if (Number(order.code) !== 1 || Number(order.status) !== 1) {
      throw new Error('ZPAY_TRADE_NOT_FOUND');
    }
    if (order.out_trade_no !== input.outTradeNo) throw new Error('ZPAY_QUERY_ORDER_MISMATCH');
    const expectedType = this.method === 'zpay_alipay' ? 'alipay' : 'wxpay';
    if (order.type !== expectedType) throw new Error('ZPAY_QUERY_METHOD_MISMATCH');
    if (String(order.pid ?? '') !== this.options.merchantId) {
      throw new Error('ZPAY_QUERY_MERCHANT_MISMATCH');
    }
    const tradeNo = typeof order.trade_no === 'string' ? order.trade_no : '';
    if (!tradeNo) throw new Error('ZPAY_TRADE_NOT_FOUND');
    const refundAmount = parseCnyPaymentAmount(input.refundAmount);
    const totalAmount = parseCnyPaymentAmount(input.totalAmount);
    if (parseCnyPaymentAmount(String(order.money)).fen !== totalAmount.fen) {
      throw new Error('ZPAY_REFUND_TOTAL_AMOUNT_MISMATCH');
    }
    if (refundAmount.fen > totalAmount.fen) throw new Error('ZPAY_REFUND_AMOUNT_INVALID');
    const providerRefundId = input.refundRequestNo ?? this.createRefundRequestNo(input);
    let payload: Record<string, unknown>;
    try {
      payload = await this.request(
        '/api.php',
        {
          act: 'refund',
          key: this.options.merchantKey,
          money: refundAmount.decimal,
          pid: this.options.merchantId,
          trade_no: tradeNo,
        },
        'POST',
      );
    } catch {
      // ZPay cannot query refunds, so a lost POST response must not trigger an automatic retry.
      return { providerRefundId, status: 'pending' };
    }
    const succeeded = Number(payload.code) === 1;
    return {
      providerRefundId,
      status: succeeded ? 'succeeded' : 'failed',
    };
  };

  verifyNotification: ModuleAppPaymentAdapter['verifyNotification'] = async ({ body }) => {
    const parameters = Object.fromEntries(new URLSearchParams(body).entries());
    const signature = parameters.sign;
    if (
      !signature ||
      parameters.sign_type?.toUpperCase() !== 'MD5' ||
      parameters.pid !== this.options.merchantId ||
      !equalSignature(signature, signZPayParameters(parameters, this.options.merchantKey))
    ) {
      throw new Error('ZPAY_NOTIFICATION_SIGNATURE_INVALID');
    }
    if (parameters.trade_status !== 'TRADE_SUCCESS') return null;
    const expectedType = this.method === 'zpay_alipay' ? 'alipay' : 'wxpay';
    if (parameters.type !== expectedType) throw new Error('ZPAY_NOTIFICATION_METHOD_MISMATCH');
    if (!parameters.out_trade_no || !parameters.money) {
      throw new Error('ZPAY_NOTIFICATION_INVALID');
    }
    const totalAmount = normalizeAmount(parameters.money);
    const tradeNo = parameters.trade_no;
    return {
      currency: 'CNY',
      eventId:
        tradeNo ??
        createHash('sha256')
          .update(`${parameters.out_trade_no}:${parameters.trade_status}:${totalAmount}`)
          .digest('hex'),
      eventType: 'payment_succeeded',
      occurredAt: new Date(),
      outTradeNo: parameters.out_trade_no,
      paymentReference: tradeNo,
      provider: this.provider,
      providerTransactionId: tradeNo,
      totalAmount,
    };
  };

  private queryOrder = (outTradeNo: string) =>
    this.request('/api.php', {
      act: 'order',
      key: this.options.merchantKey,
      out_trade_no: outTradeNo,
      pid: this.options.merchantId,
    });

  private request = async (
    pathname: string,
    parameters: Record<string, string>,
    method: 'GET' | 'POST' = 'GET',
  ) => {
    const url = new URL(pathname, this.options.apiBaseUrl);
    const body = new URLSearchParams(parameters);
    if (method === 'GET') url.search = body.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await parseResponse(
        await this.fetch(url, {
          ...(method === 'POST'
            ? {
                body,
                headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
              }
            : {}),
          method,
          signal: controller.signal,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}
