import { z } from 'zod';

import {
  moduleAppBillingPeriodSchema,
  moduleAppCurrencySchema,
  moduleAppLicenseScopeSchema,
  moduleAppProductTypeSchema,
} from './moduleAppCommerce';
import {
  paymentCheckoutActionSchema,
  paymentMethodIdSchema,
  paymentProviderSchema,
} from './payment';

export const moduleAppAiMessageSchema = z
  .object({
    content: z.string().min(1).max(100_000),
    role: z.enum(['assistant', 'system', 'user']),
  })
  .strict();
export type ModuleAppAiMessage = z.infer<typeof moduleAppAiMessageSchema>;

export const moduleAppAiChatInputSchema = z
  .object({
    maxTokens: z.number().int().min(1).max(32_768).optional(),
    messages: z.array(moduleAppAiMessageSchema).min(1).max(100),
    model: z.string().min(1).max(200),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export type ModuleAppAiChatInput = z.infer<typeof moduleAppAiChatInputSchema>;

export const moduleAppAiTokenUsageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ModuleAppAiTokenUsage = z.infer<typeof moduleAppAiTokenUsageSchema>;

export const moduleAppAiChatResultSchema = z
  .object({
    actualAiCredits: z.number().nonnegative(),
    model: z.string().min(1).max(200),
    text: z.string().max(2 * 1024 * 1024),
    tokenUsage: moduleAppAiTokenUsageSchema,
  })
  .strict();
export type ModuleAppAiChatResult = z.infer<typeof moduleAppAiChatResultSchema>;

export const moduleAppAiModelSchema = z
  .object({
    abilities: z.array(z.string().min(1).max(80)).max(20).default([]),
    displayName: z.string().min(1).max(240).optional(),
    id: z.string().min(1).max(200),
    type: z.literal('chat'),
  })
  .strict();
export type ModuleAppAiModel = z.infer<typeof moduleAppAiModelSchema>;

export const moduleAppAiModelListSchema = z.array(moduleAppAiModelSchema).max(500);
export type ModuleAppAiModelList = z.infer<typeof moduleAppAiModelListSchema>;

export const moduleAppPaymentCatalogItemSchema = z
  .object({
    amount: z.number().nonnegative(),
    billingPeriod: moduleAppBillingPeriodSchema.optional(),
    currency: moduleAppCurrencySchema,
    licenseScope: moduleAppLicenseScopeSchema,
    productId: z.string().uuid(),
    productKey: z.string().min(1).max(120),
    productType: moduleAppProductTypeSchema,
    trialDays: z.number().int().min(0).max(365),
  })
  .strict();
export type ModuleAppPaymentCatalogItem = z.infer<typeof moduleAppPaymentCatalogItemSchema>;

export const moduleAppPaymentCatalogSchema = z.array(moduleAppPaymentCatalogItemSchema).max(200);
export type ModuleAppPaymentCatalog = z.infer<typeof moduleAppPaymentCatalogSchema>;

export const moduleAppPaymentCheckoutInputSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    method: paymentMethodIdSchema.optional(),
    productId: z.string().uuid(),
  })
  .strict();
export type ModuleAppPaymentCheckoutInput = z.infer<typeof moduleAppPaymentCheckoutInputSchema>;

export const moduleAppPaymentCheckoutResultSchema = z
  .object({
    checkout: paymentCheckoutActionSchema,
    method: paymentMethodIdSchema,
    orderId: z.string().uuid(),
    outTradeNo: z.string().min(1).max(240),
    provider: paymentProviderSchema,
  })
  .strict();
export type ModuleAppPaymentCheckoutResult = z.infer<typeof moduleAppPaymentCheckoutResultSchema>;

export const moduleAppPaymentOrderStatusInputSchema = z
  .object({ orderId: z.string().uuid() })
  .strict();
export type ModuleAppPaymentOrderStatusInput = z.infer<
  typeof moduleAppPaymentOrderStatusInputSchema
>;

export const moduleAppPaymentOrderStatusSchema = z.enum([
  'cancelled',
  'paid',
  'pending',
  'refunded',
]);
export type ModuleAppPaymentOrderStatus = z.infer<typeof moduleAppPaymentOrderStatusSchema>;

export const moduleAppPaymentOrderStatusResultSchema = z
  .object({
    method: paymentMethodIdSchema.nullable(),
    paymentStatus: z.enum(['created', 'failed', 'paid', 'pending', 'refunded']).nullable(),
    provider: paymentProviderSchema.nullable(),
    status: moduleAppPaymentOrderStatusSchema,
  })
  .strict();
export type ModuleAppPaymentOrderStatusResult = z.infer<
  typeof moduleAppPaymentOrderStatusResultSchema
>;
