import { z } from 'zod';

import { paymentProviderSchema } from './payment';

const paymentAmountSchema = z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/, 'invalid_payment_amount');

export const moduleAppPaymentProviderSchema = paymentProviderSchema;
export type ModuleAppPaymentProvider = z.infer<typeof moduleAppPaymentProviderSchema>;

export const moduleAppPaymentAttemptStatusSchema = z.enum([
  'created',
  'pending',
  'paid',
  'failed',
  'refunded',
]);
export type ModuleAppPaymentAttemptStatus = z.infer<typeof moduleAppPaymentAttemptStatusSchema>;

export const moduleAppPaymentEventTypeSchema = z.enum([
  'payment_succeeded',
  'payment_failed',
  'refund_succeeded',
]);
export type ModuleAppPaymentEventType = z.infer<typeof moduleAppPaymentEventTypeSchema>;

export const moduleAppPaymentEventStatusSchema = z.enum([
  'received',
  'processed',
  'ignored',
  'rejected',
]);
export type ModuleAppPaymentEventStatus = z.infer<typeof moduleAppPaymentEventStatusSchema>;

export const moduleAppPaymentRefundStatusSchema = z.enum(['requested', 'succeeded', 'failed']);
export type ModuleAppPaymentRefundStatus = z.infer<typeof moduleAppPaymentRefundStatusSchema>;

export const moduleAppPaymentDiscrepancyKindSchema = z.enum([
  'amount_mismatch',
  'currency_mismatch',
  'duplicate_event',
  'local_paid_provider_unpaid',
  'local_unpaid_provider_paid',
  'order_not_found',
  'provider_mismatch',
  'refund_mismatch',
  'settlement_failed',
  'wrong_seller',
]);
export type ModuleAppPaymentDiscrepancyKind = z.infer<typeof moduleAppPaymentDiscrepancyKindSchema>;

export const moduleAppNormalizedPaymentEventSchema = z
  .object({
    currency: z.string().min(1).max(16),
    eventId: z.string().min(1).max(240),
    eventType: moduleAppPaymentEventTypeSchema,
    occurredAt: z.coerce.date(),
    orderId: z.string().uuid().optional(),
    outTradeNo: z.string().min(1).max(240),
    paymentReference: z.string().min(1).max(240).optional(),
    provider: moduleAppPaymentProviderSchema,
    providerTransactionId: z.string().min(1).max(240).optional(),
    totalAmount: paymentAmountSchema,
  })
  .strict();
export type ModuleAppNormalizedPaymentEvent = z.infer<typeof moduleAppNormalizedPaymentEventSchema>;
