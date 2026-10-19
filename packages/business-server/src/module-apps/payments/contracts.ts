import type {
  ModuleAppNormalizedPaymentEvent,
  ModuleAppOrderSnapshot,
  ModuleAppPaymentProvider,
  PaymentCreateResult,
  PaymentMethodId,
  PaymentPurpose,
} from '@lobechat/types';

export interface ModuleAppPaymentAdapter {
  create: (input: {
    currency: ModuleAppOrderSnapshot['currency'];
    expiresAt?: string;
    notifyUrl: string;
    orderId: string;
    purpose?: PaymentPurpose;
    returnUrl: string;
    subject: string;
    totalAmount: string;
  }) => Promise<PaymentCreateResult>;
  createOutTradeNo: (input: { orderId: string; purpose: PaymentPurpose }) => string;
  createRefundRequestNo: (input: { outTradeNo: string; refundAmount: string }) => string;
  readonly method: PaymentMethodId;
  readonly provider: ModuleAppPaymentProvider;
  query: (input: { outTradeNo: string }) => Promise<ModuleAppNormalizedPaymentEvent | null>;
  queryRefund?: (input: {
    outRequestNo: string;
    outTradeNo: string;
  }) => Promise<{ status: 'failed' | 'pending' | 'succeeded' }>;
  refund: (input: {
    outTradeNo: string;
    reason: string;
    refundAmount: string;
    refundRequestNo?: string;
    totalAmount: string;
  }) => Promise<{
    providerRefundId: string;
    status: 'failed' | 'pending' | 'succeeded';
  }>;
  verifyNotification: (input: {
    body: string;
    headers: Record<string, string>;
  }) => Promise<ModuleAppNormalizedPaymentEvent | null>;
}

export const canRecreatePaymentCheckout = (method: PaymentMethodId) => method !== 'wechat_pay';

export type { ModuleAppNormalizedPaymentEvent, ModuleAppPaymentProvider };
