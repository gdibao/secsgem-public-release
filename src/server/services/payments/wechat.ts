import {
  createDecipheriv,
  createHash,
  randomBytes,
  sign as rsaSign,
  verify as rsaVerify,
} from 'node:crypto';

import type { ModuleAppPaymentAdapter } from '@/business/server/module-apps/payments/contracts';

import { formatCnyPaymentAmountFromFen, parseCnyPaymentAmount } from './amount';

type FetchLike = typeof fetch;

export type WechatPayClientOptions = {
  apiBaseUrl: string;
  apiV3Key: string;
  appId: string;
  fetch?: FetchLike;
  mchId: string;
  merchantPrivateKey: string;
  merchantSerialNo: string;
  platformCertificate: string;
  platformCertificateSerialNo: string;
  timeoutMs?: number;
};

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

const normalizeCertificateSerial = (value: string) =>
  value.replaceAll(':', '').trim().replace(/^0+/, '').toUpperCase();

const normalizeHeaders = (headers: Headers) =>
  Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));

const normalizeRefundStatus = (status: unknown) =>
  status === 'SUCCESS'
    ? ('succeeded' as const)
    : status === 'CLOSED' || status === 'ABNORMAL'
      ? ('failed' as const)
      : ('pending' as const);

export class WechatPayClient implements ModuleAppPaymentAdapter {
  readonly method = 'wechat_pay' as const;
  readonly provider = 'wechat_pay' as const;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: WechatPayClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
    new URL(options.apiBaseUrl);
    if (Buffer.byteLength(options.apiV3Key, 'utf8') !== 32) {
      throw new Error('WECHAT_PAY_API_V3_KEY_INVALID');
    }
  }

  createOutTradeNo: ModuleAppPaymentAdapter['createOutTradeNo'] = ({ orderId, purpose }) => {
    const purposePrefix = purpose === 'module_app' ? 'm' : purpose === 'subscription' ? 's' : 't';
    return `${purposePrefix}${createHash('sha256')
      .update(`${purpose}:${orderId}`)
      .digest('hex')
      .slice(0, 31)}`;
  };

  createRefundRequestNo: ModuleAppPaymentAdapter['createRefundRequestNo'] = (input) =>
    `wr${createHash('sha256')
      .update(`${input.outTradeNo}:${input.refundAmount}`)
      .digest('hex')
      .slice(0, 30)}`;

  create: ModuleAppPaymentAdapter['create'] = async (input) => {
    if (input.currency !== 'CNY') throw new Error('WECHAT_PAY_CURRENCY_UNSUPPORTED');
    const outTradeNo = this.createOutTradeNo({
      orderId: input.orderId,
      purpose: input.purpose ?? 'module_app',
    });
    const response = await this.request('POST', '/v3/pay/transactions/native', {
      amount: { currency: 'CNY', total: parseCnyPaymentAmount(input.totalAmount).fen },
      appid: this.options.appId,
      description: input.subject,
      mchid: this.options.mchId,
      notify_url: input.notifyUrl,
      out_trade_no: outTradeNo,
      ...(input.expiresAt ? { time_expire: new Date(input.expiresAt).toISOString() } : {}),
    });
    const codeUrl = typeof response.code_url === 'string' ? response.code_url : '';
    if (!codeUrl) throw new Error('WECHAT_PAY_CODE_URL_MISSING');
    return {
      checkout: { type: 'qrcode', url: codeUrl },
      method: this.method,
      outTradeNo,
      provider: this.provider,
    };
  };

  query: ModuleAppPaymentAdapter['query'] = async ({ outTradeNo }) => {
    const response = await this.request(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.options.mchId)}`,
    );
    const tradeState = typeof response.trade_state === 'string' ? response.trade_state : '';
    if (['NOTPAY', 'USERPAYING'].includes(tradeState)) return null;
    const eventType = tradeState === 'SUCCESS' ? 'payment_succeeded' : 'payment_failed';
    const amount = response.amount as Record<string, unknown> | undefined;
    return {
      currency: amount?.currency === 'CNY' ? 'CNY' : String(amount?.currency ?? 'CNY'),
      eventId: `query:${outTradeNo}:${tradeState}`,
      eventType,
      occurredAt: response.success_time ? new Date(String(response.success_time)) : new Date(),
      outTradeNo,
      paymentReference:
        typeof response.transaction_id === 'string' ? response.transaction_id : undefined,
      provider: this.provider,
      providerTransactionId:
        typeof response.transaction_id === 'string' ? response.transaction_id : undefined,
      totalAmount: formatCnyPaymentAmountFromFen(amount?.total),
    };
  };

  refund: ModuleAppPaymentAdapter['refund'] = async (input) => {
    const outRefundNo = input.refundRequestNo ?? this.createRefundRequestNo(input);
    const refund = parseCnyPaymentAmount(input.refundAmount).fen;
    const total = parseCnyPaymentAmount(input.totalAmount).fen;
    if (refund > total) throw new Error('WECHAT_PAY_REFUND_AMOUNT_INVALID');
    const response = await this.request('POST', '/v3/refund/domestic/refunds', {
      amount: { currency: 'CNY', refund, total },
      out_refund_no: outRefundNo,
      out_trade_no: input.outTradeNo,
      reason: input.reason,
    });
    return { providerRefundId: outRefundNo, status: normalizeRefundStatus(response.status) };
  };

  queryRefund = async (input: { outRequestNo: string; outTradeNo: string }) => {
    let response: Record<string, unknown>;
    try {
      response = await this.request(
        'GET',
        `/v3/refund/domestic/refunds/${encodeURIComponent(input.outRequestNo)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'WECHAT_PAY_HTTP_404') {
        return { status: 'failed' as const };
      }
      throw error;
    }
    return { status: normalizeRefundStatus(response.status) };
  };

  verifyNotification: ModuleAppPaymentAdapter['verifyNotification'] = async ({ body, headers }) => {
    this.verifySignature(
      body,
      Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    );
    const envelope = JSON.parse(body) as Record<string, unknown>;
    const resource = envelope.resource as Record<string, unknown> | undefined;
    if (
      resource?.algorithm !== 'AEAD_AES_256_GCM' ||
      typeof resource.ciphertext !== 'string' ||
      typeof resource.nonce !== 'string'
    ) {
      throw new Error('WECHAT_PAY_NOTIFICATION_RESOURCE_INVALID');
    }
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    if (ciphertext.length <= 16) throw new Error('WECHAT_PAY_NOTIFICATION_CIPHERTEXT_INVALID');
    const encrypted = ciphertext.subarray(0, -16);
    const authTag = ciphertext.subarray(-16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.options.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(String(resource.associated_data ?? ''), 'utf8'));
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      'utf8',
    );
    const transaction = JSON.parse(plaintext) as Record<string, unknown>;
    const notificationType = typeof envelope.event_type === 'string' ? envelope.event_type : '';
    const refundNotification =
      notificationType.startsWith('REFUND.') || typeof transaction.refund_status === 'string';
    if (
      transaction.mchid !== this.options.mchId ||
      (!refundNotification && transaction.appid !== this.options.appId)
    ) {
      throw new Error('WECHAT_PAY_NOTIFICATION_MERCHANT_MISMATCH');
    }
    const outTradeNo = typeof transaction.out_trade_no === 'string' ? transaction.out_trade_no : '';
    const eventId = typeof envelope.id === 'string' ? envelope.id : '';
    const amount = transaction.amount as Record<string, unknown> | undefined;
    if (!outTradeNo || !eventId || !amount) throw new Error('WECHAT_PAY_NOTIFICATION_INVALID');

    if (refundNotification) {
      const refundStatus =
        typeof transaction.refund_status === 'string' ? transaction.refund_status : '';
      if (refundStatus !== 'SUCCESS') return null;
      return {
        currency: amount.currency === 'CNY' ? 'CNY' : String(amount.currency ?? 'CNY'),
        eventId,
        eventType: 'refund_succeeded',
        occurredAt: transaction.success_time
          ? new Date(String(transaction.success_time))
          : new Date(),
        outTradeNo,
        paymentReference:
          typeof transaction.refund_id === 'string'
            ? transaction.refund_id
            : typeof transaction.out_refund_no === 'string'
              ? transaction.out_refund_no
              : undefined,
        provider: this.provider,
        providerTransactionId:
          typeof transaction.transaction_id === 'string' ? transaction.transaction_id : undefined,
        totalAmount: formatCnyPaymentAmountFromFen(amount.refund),
      };
    }

    const tradeState = typeof transaction.trade_state === 'string' ? transaction.trade_state : '';
    if (['NOTPAY', 'USERPAYING'].includes(tradeState)) return null;
    return {
      currency: amount.currency === 'CNY' ? 'CNY' : String(amount.currency ?? 'CNY'),
      eventId,
      eventType: tradeState === 'SUCCESS' ? 'payment_succeeded' : 'payment_failed',
      occurredAt: transaction.success_time
        ? new Date(String(transaction.success_time))
        : new Date(),
      outTradeNo,
      paymentReference:
        typeof transaction.transaction_id === 'string' ? transaction.transaction_id : undefined,
      provider: this.provider,
      providerTransactionId:
        typeof transaction.transaction_id === 'string' ? transaction.transaction_id : undefined,
      totalAmount: formatCnyPaymentAmountFromFen(amount.total),
    };
  };

  private authorization = (method: string, pathWithQuery: string, body: string) => {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = rsaSign(
      'RSA-SHA256',
      Buffer.from(message),
      this.options.merchantPrivateKey,
    ).toString('base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.options.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.options.merchantSerialNo}",signature="${signature}"`;
  };

  private verifySignature = (body: string, headers: Record<string, string>) => {
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const serial = headers['wechatpay-serial'];
    const signature = headers['wechatpay-signature'];
    if (!timestamp || !nonce || !serial || !signature) {
      throw new Error('WECHAT_PAY_RESPONSE_SIGNATURE_MISSING');
    }
    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || timestampSeconds <= 0) {
      throw new Error('WECHAT_PAY_RESPONSE_TIMESTAMP_INVALID');
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_SIGNATURE_AGE_SECONDS) {
      throw new Error('WECHAT_PAY_RESPONSE_TIMESTAMP_STALE');
    }
    if (
      normalizeCertificateSerial(serial) !==
      normalizeCertificateSerial(this.options.platformCertificateSerialNo)
    ) {
      throw new Error('WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL_MISMATCH');
    }
    const valid = rsaVerify(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
      this.options.platformCertificate,
      Buffer.from(signature, 'base64'),
    );
    if (!valid) throw new Error('WECHAT_PAY_RESPONSE_SIGNATURE_INVALID');
  };

  private request = async (
    method: 'GET' | 'POST',
    pathWithQuery: string,
    payload?: Record<string, unknown>,
  ) => {
    const body = payload ? JSON.stringify(payload) : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(new URL(pathWithQuery, this.options.apiBaseUrl), {
        ...(body ? { body } : {}),
        headers: {
          'Accept': 'application/json',
          'Authorization': this.authorization(method, pathWithQuery, body),
          'Content-Type': 'application/json',
          'User-Agent': 'ComHub-Payment/1.0',
        },
        method,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      if (!response.ok) throw new Error(`WECHAT_PAY_HTTP_${response.status}`);
      this.verifySignature(responseBody, normalizeHeaders(response.headers));
      const result = JSON.parse(responseBody) as unknown;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('WECHAT_PAY_RESPONSE_INVALID');
      }
      return result as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  };
}
