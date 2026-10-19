import { z } from 'zod';

export const MODULE_APP_MAX_MULTIPLIER = 100;
export const MODULE_APP_MULTIPLIER_SCALE = 4;

const DECIMAL_PATTERN = /^\d+(?:\.\d{1,4})?$/;
const RATE_PATTERN = /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/;

export const moduleAppMultiplierSchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(MODULE_APP_MAX_MULTIPLIER)
  .refine(
    (value) => Number.isInteger(value * 10 ** MODULE_APP_MULTIPLIER_SCALE),
    'module_app_multiplier_precision_exceeded',
  );

export const moduleAppDecimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN)
  .refine((value) => Number(value) <= MODULE_APP_MAX_MULTIPLIER);

export const moduleAppRateStringSchema = z.string().regex(RATE_PATTERN);
export const moduleAppCurrencySchema = z.enum(['CNY', 'USD']);
export const moduleAppProductTypeSchema = z.enum(['free', 'one_time', 'subscription']);
export const moduleAppBillingPeriodSchema = z.enum(['monthly', 'yearly']);
export const moduleAppLicenseScopeSchema = z.enum(['personal', 'workspace_seat', 'workspace']);
export const moduleAppOrderStatusSchema = z.enum(['pending', 'paid', 'cancelled', 'refunded']);
export const moduleAppLicenseStatusSchema = z.enum(['active', 'expired', 'revoked']);
export const moduleAppSubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
]);

export const moduleAppPromotionSnapshotSchema = z
  .object({
    couponCode: z.string().min(1).max(80).optional(),
    discountAmount: z.number().int().min(0).default(0),
    discountPercent: z.number().min(0).max(100).default(0),
    promotionId: z.string().uuid().optional(),
    title: z.string().min(1).max(160).optional(),
    validUntil: z.string().datetime().optional(),
  })
  .strict();

const moduleAppProductShape = {
  billingPeriod: moduleAppBillingPeriodSchema.optional(),
  currency: moduleAppCurrencySchema,
  licenseScope: moduleAppLicenseScopeSchema,
  price: z.number().int().min(0).max(1_000_000_000),
  productType: moduleAppProductTypeSchema,
  seatCount: z.number().int().min(1).max(100_000).optional(),
  trialDays: z.number().int().min(0).max(365).default(0),
};

const validateProductConsistency = (
  value: {
    billingPeriod?: string;
    licenseScope: string;
    price: number;
    productType: string;
    seatCount?: number;
  },
  ctx: z.RefinementCtx,
) => {
  if (value.productType === 'subscription' && !value.billingPeriod) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_billing_period_required' });
  }
  if (value.productType !== 'subscription' && value.billingPeriod) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_billing_period_forbidden' });
  }
  if (value.productType === 'free' && value.price !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_free_price_invalid' });
  }
  if (value.licenseScope === 'workspace_seat' && !value.seatCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_seat_count_required' });
  }
};

export const moduleAppProductSchema = z
  .object(moduleAppProductShape)
  .strict()
  .superRefine(validateProductConsistency);

export const moduleAppBillingPayerSchema = z.discriminatedUnion('scopeType', [
  z.object({ scopeType: z.literal('personal'), userId: z.string().min(1).max(200) }).strict(),
  z.object({ scopeType: z.literal('workspace'), workspaceId: z.string().min(1).max(200) }).strict(),
]);

export const moduleAppPurchaseInputSchema = z
  .object({
    couponCode: z.string().min(1).max(80).optional(),
    licenseScope: moduleAppLicenseScopeSchema,
    productId: z.string().uuid(),
    seatCount: z.number().int().min(1).max(100_000).optional(),
    workspaceId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.licenseScope !== 'personal' && !value.workspaceId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_workspace_required' });
    }
    if (value.licenseScope === 'personal' && value.workspaceId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_workspace_forbidden' });
    }
    if (value.licenseScope === 'workspace_seat' && !value.seatCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_seat_count_required' });
    }
  });

export const moduleAppOrderSnapshotSchema = z
  .object({
    ...moduleAppProductShape,
    moduleMultiplier: moduleAppDecimalStringSchema,
    promotion: moduleAppPromotionSnapshotSchema.optional(),
    revenueShareRate: moduleAppRateStringSchema,
    termsVersion: z.string().min(1).max(80).default('1'),
    versionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine(validateProductConsistency);

export type ModuleAppBillingPayer = z.infer<typeof moduleAppBillingPayerSchema>;
export type ModuleAppLicenseScope = z.infer<typeof moduleAppLicenseScopeSchema>;
export type ModuleAppOrderSnapshot = z.infer<typeof moduleAppOrderSnapshotSchema>;
export type ModuleAppOrderStatus = z.infer<typeof moduleAppOrderStatusSchema>;
export type ModuleAppProduct = z.infer<typeof moduleAppProductSchema>;
export type ModuleAppPurchaseInput = z.infer<typeof moduleAppPurchaseInputSchema>;
