import { createHash } from 'node:crypto';

import type { ModuleAppPaymentAdapter } from '@/business/server/module-apps/payments/contracts';
import { appEnv } from '@/envs/app';
import { parseCnyPaymentAmount } from '@/server/services/payments/amount';

import { mapAlipayTradeToPaymentEvent, paymentOrderIdToAlipayTradeNo } from './mapper';
import {
  signAlipayParameters,
  verifyAlipayContentSignature,
  verifyAlipaySignature,
} from './signature';

type FetchLike = typeof fetch;

export type AlipayClientOptions = {
  alipayPublicKey: string;
  alipayRootCertSn?: string;
  appCertSn?: string;
  appId: string;
  fetch?: FetchLike;
  gateway: string;
  merchantPrivateKey: string;
  sellerId: string;
  timeoutMs?: number;
};

const formatTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

const extractResponseContent = (body: string, key: string) => {
  const keyIndex = body.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;
  const colonIndex = body.indexOf(':', keyIndex + key.length + 2);
  if (colonIndex < 0) return null;
  let start = colonIndex + 1;
  while (/\s/.test(body[start] ?? '')) start += 1;
  if (body[start] !== '{') return null;
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < body.length; index += 1) {
    const character = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, index + 1);
    }
  }
  return null;
};

export class AlipayModuleAppClient implements ModuleAppPaymentAdapter {
  readonly method = 'alipay' as const;
  readonly provider = 'alipay' as const;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: AlipayClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
    new URL(options.gateway);
    if (Boolean(options.appCertSn) !== Boolean(options.alipayRootCertSn)) {
      throw new Error('MODULE_APP_ALIPAY_CERT_SERIALS_REQUIRED');
    }
  }

  createOutTradeNo: ModuleAppPaymentAdapter['createOutTradeNo'] = ({ orderId, purpose }) =>
    paymentOrderIdToAlipayTradeNo(orderId, purpose);

  createRefundRequestNo: ModuleAppPaymentAdapter['createRefundRequestNo'] = (input) =>
    `refund_${createHash('sha256')
      .update(`${input.outTradeNo}:${input.refundAmount}`)
      .digest('hex')
      .slice(0, 32)}`;

  create: ModuleAppPaymentAdapter['create'] = async (input) => {
    if (input.currency !== 'CNY') {
      throw new Error('MODULE_APP_ALIPAY_CURRENCY_UNSUPPORTED');
    }
    const outTradeNo = this.createOutTradeNo({
      orderId: input.orderId,
      purpose: input.purpose ?? 'module_app',
    });
    const amount = parseCnyPaymentAmount(input.totalAmount);
    const parameters = this.signRequest(
      'alipay.trade.page.pay',
      {
        out_trade_no: outTradeNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        subject: input.subject,
        ...(input.expiresAt ? { time_expire: formatTimestamp(new Date(input.expiresAt)) } : {}),
        total_amount: amount.decimal,
      },
      { notify_url: input.notifyUrl, return_url: input.returnUrl },
    );
    return {
      checkout: {
        fields: parameters,
        method: 'POST' as const,
        type: 'form' as const,
        url: this.options.gateway,
      },
      method: this.method,
      outTradeNo,
      provider: this.provider,
    };
  };

  query: ModuleAppPaymentAdapter['query'] = async ({ outTradeNo }) => {
    const response = await this.request('alipay.trade.query', { out_trade_no: outTradeNo });
    return mapAlipayTradeToPaymentEvent({
      eventId: `query:${outTradeNo}:${String(response.trade_status ?? 'UNKNOWN')}`,
      gmtRefund: typeof response.gmt_refund === 'string' ? response.gmt_refund : undefined,
      outTradeNo: String(response.out_trade_no ?? outTradeNo),
      refundAmount: typeof response.refund_amount === 'string' ? response.refund_amount : undefined,
      totalAmount: typeof response.total_amount === 'string' ? response.total_amount : undefined,
      tradeNo: typeof response.trade_no === 'string' ? response.trade_no : undefined,
      tradeStatus: typeof response.trade_status === 'string' ? response.trade_status : undefined,
    });
  };

  refund: ModuleAppPaymentAdapter['refund'] = async (input) => {
    const refundAmount = parseCnyPaymentAmount(input.refundAmount);
    const outRequestNo = input.refundRequestNo ?? this.createRefundRequestNo(input);
    const response = await this.request('alipay.trade.refund', {
      out_request_no: outRequestNo,
      out_trade_no: input.outTradeNo,
      refund_amount: refundAmount.decimal,
      refund_reason: input.reason,
    });
    return {
      providerRefundId:
        typeof response.out_request_no === 'string' ? response.out_request_no : outRequestNo,
      status: response.fund_change === 'Y' ? 'succeeded' : 'pending',
    };
  };

  queryRefund = async (input: { outRequestNo: string; outTradeNo: string }) => {
    let response: Record<string, unknown>;
    try {
      response = await this.request('alipay.trade.fastpay.refund.query', {
        out_request_no: input.outRequestNo,
        out_trade_no: input.outTradeNo,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('TRADE_NOT_EXIST') || error.message.includes('REFUND_NOT_EXIST'))
      ) {
        return { status: 'failed' as const };
      }
      throw error;
    }
    const status =
      response.refund_status === 'REFUND_SUCCESS' || typeof response.refund_amount === 'string'
        ? 'succeeded'
        : 'pending';
    return { status } as const;
  };

  verifyNotification: ModuleAppPaymentAdapter['verifyNotification'] = async ({ body }) => {
    const parameters = Object.fromEntries(new URLSearchParams(body).entries());
    if (
      parameters.sign_type !== 'RSA2' ||
      !verifyAlipaySignature(parameters, this.options.alipayPublicKey, { excludeSignType: true }) ||
      parameters.app_id !== this.options.appId ||
      parameters.seller_id !== this.options.sellerId
    ) {
      return null;
    }
    return mapAlipayTradeToPaymentEvent({
      eventId: parameters.notify_id,
      gmtPayment: parameters.gmt_payment,
      gmtRefund: parameters.gmt_refund,
      notifyTime: parameters.notify_time,
      outTradeNo: parameters.out_trade_no,
      refundAmount: parameters.refund_fee,
      totalAmount: parameters.total_amount,
      tradeNo: parameters.trade_no,
      tradeStatus: parameters.trade_status,
    });
  };

  queryBillDownloadUrl = async (input: {
    billDate: string;
    billType: 'signcustomer' | 'trade';
  }) => {
    const response = await this.request('alipay.data.dataservice.bill.downloadurl.query', {
      bill_date: input.billDate,
      bill_type: input.billType,
    });
    if (typeof response.bill_download_url !== 'string') {
      throw new Error('MODULE_APP_ALIPAY_BILL_URL_INVALID');
    }
    return response.bill_download_url;
  };

  private signRequest = (
    method: string,
    bizContent: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) => {
    const parameters: Record<string, string> = {
      ...(this.options.alipayRootCertSn
        ? { alipay_root_cert_sn: this.options.alipayRootCertSn }
        : {}),
      ...(this.options.appCertSn ? { app_cert_sn: this.options.appCertSn } : {}),
      app_id: this.options.appId,
      biz_content: JSON.stringify(bizContent),
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- Alipay requires this exact protocol value.
      charset: 'utf-8',
      format: 'JSON',
      method,
      sign_type: 'RSA2',
      timestamp: formatTimestamp(),
      version: '1.0',
      ...extra,
    };
    return {
      ...parameters,
      sign: signAlipayParameters(parameters, this.options.merchantPrivateKey),
    };
  };

  private request = async (method: string, bizContent: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.options.gateway, {
        body: new URLSearchParams(this.signRequest(method, bizContent)),
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MODULE_APP_ALIPAY_HTTP_${response.status}`);
      const responseBody = await response.text();
      const payload = JSON.parse(responseBody) as unknown;
      if (!payload || typeof payload !== 'object')
        throw new Error('MODULE_APP_ALIPAY_RESPONSE_INVALID');
      const key = `${method.replaceAll('.', '_')}_response`;
      const result = (payload as Record<string, unknown>)[key];
      if (!result || typeof result !== 'object')
        throw new Error('MODULE_APP_ALIPAY_RESPONSE_INVALID');
      const signature = (payload as Record<string, unknown>).sign;
      const responseContent = extractResponseContent(responseBody, key);
      if (
        typeof signature !== 'string' ||
        !responseContent ||
        !verifyAlipayContentSignature(responseContent, signature, this.options.alipayPublicKey)
      ) {
        throw new Error('MODULE_APP_ALIPAY_RESPONSE_SIGNATURE_INVALID');
      }
      const data = result as Record<string, unknown>;
      if (data.code !== '10000') {
        const code =
          typeof data.sub_code === 'string' ? data.sub_code : String(data.code ?? 'UNKNOWN');
        throw new Error(`MODULE_APP_ALIPAY_API_${code}`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };
}

const requiredConfiguration = (value: string | undefined, code: string) => {
  if (!value) throw new Error(code);
  return value.replaceAll('\\n', '\n').trim();
};

export const createConfiguredModuleAppAlipayClient = () => {
  if (!appEnv.MODULE_APP_ALIPAY_ENABLED) throw new Error('MODULE_APP_ALIPAY_DISABLED');
  const verificationKey =
    appEnv.MODULE_APP_ALIPAY_CERT_MODE === 'certificate'
      ? appEnv.MODULE_APP_ALIPAY_CERTIFICATE
      : appEnv.MODULE_APP_ALIPAY_PUBLIC_KEY;
  return new AlipayModuleAppClient({
    alipayPublicKey: requiredConfiguration(
      verificationKey,
      'MODULE_APP_ALIPAY_VERIFICATION_KEY_REQUIRED',
    ),
    appId: requiredConfiguration(
      appEnv.MODULE_APP_ALIPAY_APP_ID,
      'MODULE_APP_ALIPAY_APP_ID_REQUIRED',
    ),
    ...(appEnv.MODULE_APP_ALIPAY_CERT_MODE === 'certificate'
      ? {
          alipayRootCertSn: requiredConfiguration(
            appEnv.MODULE_APP_ALIPAY_ROOT_CERT_SN,
            'MODULE_APP_ALIPAY_ROOT_CERT_SN_REQUIRED',
          ),
          appCertSn: requiredConfiguration(
            appEnv.MODULE_APP_ALIPAY_APP_CERT_SN,
            'MODULE_APP_ALIPAY_APP_CERT_SN_REQUIRED',
          ),
        }
      : {}),
    gateway: appEnv.MODULE_APP_ALIPAY_GATEWAY,
    merchantPrivateKey: requiredConfiguration(
      appEnv.MODULE_APP_ALIPAY_MERCHANT_PRIVATE_KEY,
      'MODULE_APP_ALIPAY_PRIVATE_KEY_REQUIRED',
    ),
    sellerId: requiredConfiguration(
      appEnv.MODULE_APP_ALIPAY_SELLER_ID,
      'MODULE_APP_ALIPAY_SELLER_ID_REQUIRED',
    ),
  });
};
