import { createHash } from 'node:crypto';

import type { ModuleAppNormalizedPaymentEvent, PaymentPurpose } from '@lobechat/types';

const normalizeAmount = (value: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount.toFixed(6);
};

const parseAlipayDate = (value?: string) => {
  if (!value) return new Date();
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const paymentOrderIdToAlipayTradeNo = (orderId: string, purpose: PaymentPurpose) => {
  const prefix = purpose === 'module_app' ? 'mapp' : purpose === 'subscription' ? 'sub' : 'topup';
  return `${prefix}_${orderId.replaceAll('-', '').toLowerCase()}`;
};

export const moduleAppOrderIdToAlipayTradeNo = (orderId: string) =>
  paymentOrderIdToAlipayTradeNo(orderId, 'module_app');

export const alipayTradeNoToModuleAppOrderId = (outTradeNo: string) => {
  const match = /^(?:mapp|sub|topup)_([a-f0-9]{32})$/i.exec(outTradeNo);
  if (!match) return undefined;
  const value = match[1].toLowerCase();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

export const mapAlipayTradeToPaymentEvent = (input: {
  eventId?: string;
  gmtPayment?: string;
  gmtRefund?: string;
  notifyTime?: string;
  outTradeNo?: string;
  refundAmount?: string;
  totalAmount?: string;
  tradeNo?: string;
  tradeStatus?: string;
}): ModuleAppNormalizedPaymentEvent | null => {
  if (!input.outTradeNo || !input.tradeStatus) return null;
  const refunded = input.tradeStatus === 'TRADE_CLOSED' && Boolean(input.refundAmount);
  const eventType = refunded
    ? 'refund_succeeded'
    : input.tradeStatus === 'TRADE_SUCCESS' || input.tradeStatus === 'TRADE_FINISHED'
      ? 'payment_succeeded'
      : input.tradeStatus === 'TRADE_CLOSED'
        ? 'payment_failed'
        : null;
  const eventAmount = refunded ? input.refundAmount : input.totalAmount;
  if (!eventType || !eventAmount) return null;
  const totalAmount = normalizeAmount(eventAmount);
  if (!totalAmount) return null;
  const eventId =
    input.eventId ??
    createHash('sha256')
      .update(`${input.outTradeNo}:${input.tradeNo ?? ''}:${input.tradeStatus}:${totalAmount}`)
      .digest('hex');
  return {
    currency: 'CNY',
    eventId,
    eventType,
    occurredAt: parseAlipayDate(
      refunded ? (input.gmtRefund ?? input.notifyTime) : (input.gmtPayment ?? input.notifyTime),
    ),
    orderId: alipayTradeNoToModuleAppOrderId(input.outTradeNo),
    outTradeNo: input.outTradeNo,
    paymentReference: input.tradeNo,
    provider: 'alipay',
    providerTransactionId: input.tradeNo,
    totalAmount,
  };
};
