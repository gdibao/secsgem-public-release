import { z } from 'zod';

import { Plans } from './subscription';
import { type ReferralStatusString } from './user/preference';

const pricingRuleSelectorSchema = z.string().trim().min(1).max(240);

export const aiUsagePricingRuleSchema = z
  .object({
    creditsPerDollar: z.number().finite().positive().max(1_000_000_000_000).optional(),
    group: pricingRuleSelectorSchema.optional(),
    instanceId: pricingRuleSelectorSchema.optional(),
    model: pricingRuleSelectorSchema.optional(),
    multiplier: z.number().finite().positive().max(1000).optional(),
    provider: pricingRuleSelectorSchema.optional(),
    providerType: pricingRuleSelectorSchema.optional(),
  })
  .strict();

export const aiUsagePricingRulesSchema = z.array(aiUsagePricingRuleSchema).max(10_000);
export type AiUsagePricingRule = z.infer<typeof aiUsagePricingRuleSchema>;

export const SubscriptionStatusEnum = {
  Active: 'active',
  Canceled: 'canceled',
  Expired: 'expired',
  GracePeriod: 'grace_period',
  Trialing: 'trialing',
} as const;

export type SubscriptionStatusType =
  (typeof SubscriptionStatusEnum)[keyof typeof SubscriptionStatusEnum];

export const SubscriptionCycleEnum = {
  Lifetime: 'lifetime',
  Monthly: 'monthly',
  OneTime: 'one_time',
  Yearly: 'yearly',
} as const;

export type SubscriptionCycleType =
  (typeof SubscriptionCycleEnum)[keyof typeof SubscriptionCycleEnum];

export const SubscriptionChangeRequestStatusEnum = {
  Canceled: 'canceled',
  Completed: 'completed',
  Pending: 'pending',
  Rejected: 'rejected',
} as const;

export type SubscriptionChangeRequestStatusType =
  (typeof SubscriptionChangeRequestStatusEnum)[keyof typeof SubscriptionChangeRequestStatusEnum];

export const SubscriptionChangeRequestReasonEnum = {
  CycleChange: 'cycle_change',
  Downgrade: 'downgrade',
  Upgrade: 'upgrade',
} as const;

export type SubscriptionChangeRequestReasonType =
  (typeof SubscriptionChangeRequestReasonEnum)[keyof typeof SubscriptionChangeRequestReasonEnum];

export const CreditLedgerEntryTypeEnum = {
  Adjustment: 'adjustment',
  Bonus: 'bonus',
  Consume: 'consume',
  Expire: 'expire',
  ReferralReward: 'referral_reward',
  Refund: 'refund',
  SubscriptionGrant: 'subscription_grant',
  TopUp: 'topup',
} as const;

export type CreditLedgerEntryType =
  (typeof CreditLedgerEntryTypeEnum)[keyof typeof CreditLedgerEntryTypeEnum];

export const CreditSourceEnum = {
  Other: 'other',
  Referral: 'referral',
  Subscription: 'subscription',
  TopUp: 'topup',
} as const;

export type CreditSourceType = (typeof CreditSourceEnum)[keyof typeof CreditSourceEnum];

export interface CreditSourceSummary {
  available: number;
  consumed: number;
  credited: number;
}

export interface CreditConsumeAllocation {
  amount: number;
  lotId?: string;
  source: CreditSourceType;
}

export const TopUpOrderStatusEnum = {
  Canceled: 'canceled',
  Expired: 'expired',
  Failed: 'failed',
  Paid: 'paid',
  Pending: 'pending',
  Refunded: 'refunded',
} as const;

export type TopUpOrderStatusType = (typeof TopUpOrderStatusEnum)[keyof typeof TopUpOrderStatusEnum];

export const TopUpOrderSourceEnum = {
  Alipay: 'alipay',
  Manual: 'manual',
  Redemption: 'redemption',
  WechatPay: 'wechat_pay',
  ZPay: 'zpay',
} as const;

export type TopUpOrderSourceType = (typeof TopUpOrderSourceEnum)[keyof typeof TopUpOrderSourceEnum];

export type BillingOrderKind = 'subscription' | 'topup';

export interface BillingOrderHistoryItem {
  amount: number;
  createdAt: Date;
  credits?: number | null;
  currency: string;
  cycle?: SubscriptionCycleType | null;
  displayName?: string | null;
  externalOrderId?: string | null;
  id: string;
  kind: BillingOrderKind;
  method?: string | null;
  paidAt?: Date | null;
  plan?: Plans | null;
  provider?: string | null;
  status: TopUpOrderStatusType;
}

export interface CreditAccountSummary {
  balance: number;
  breakdown: Record<CreditSourceType, CreditSourceSummary>;
  currency: string;
  totalCredited: number;
  totalDebited: number;
  updatedAt?: Date | null;
}

export const AUTO_TOP_UP_AVAILABLE = false;
export const AUTO_TOP_UP_RECURRING_PAYMENT_UNAVAILABLE_ERROR =
  'AUTO_TOP_UP_RECURRING_PAYMENT_UNAVAILABLE';

export interface AutoTopUpSetting {
  enabled: boolean;
  monthlyLimit?: number | null;
  monthlyTopUpAmount: number;
  targetBalance: number;
  threshold: number;
  updatedAt?: Date | null;
}

export interface CreditLedgerEntryItem {
  amount: number;
  balanceAfter: number;
  createdAt: Date;
  description?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  referenceId?: string | null;
  referenceType?: string | null;
  title?: string | null;
  type: CreditLedgerEntryType;
}

export interface CreditLedgerListResult {
  items: CreditLedgerEntryItem[];
  nextCursor?: string;
}

export type CreditPackageStatusType = 'active' | 'depleted' | 'expired';

export interface CreditPackageHistoryItem {
  consumedAmount: number;
  createdAt: Date;
  expiredAmount: number;
  expiresAt?: Date | null;
  grantedAmount: number;
  id: string;
  referenceId: string;
  referenceType: string;
  refundedAmount: number;
  remainingAmount: number;
  source: CreditSourceType;
  status: CreditPackageStatusType;
  updatedAt: Date;
}

export interface SubscriptionSummary {
  currency: string;
  currentCyclePrice: number;
  cycle: SubscriptionCycleType;
  endsAt?: Date | null;
  externalSubscriptionId?: string | null;
  isFreePlan: boolean;
  monthlyCredits: number;
  monthlyPrice: number;
  plan: Plans;
  provider?: string | null;
  renewsAt?: Date | null;
  startedAt?: Date | null;
  status: SubscriptionStatusType;
}

export interface SubscriptionChangeRequestItem {
  createdAt: Date;
  cycle: SubscriptionCycleType;
  fromPlan: Plans;
  id: string;
  reason: SubscriptionChangeRequestReasonType;
  status: SubscriptionChangeRequestStatusType;
  toPlan: Plans;
  updatedAt?: Date | null;
}

export interface CommercialOverview {
  account: CreditAccountSummary;
  subscription: SubscriptionSummary;
}

export interface CommercialResourceUsage {
  storage: {
    quota: number | null;
    used: number;
  };
  vector: {
    quota: number | null;
    used: number;
  };
}

export interface ReferralOverview {
  currentReferralStatus?: ReferralStatusString;
  referralCode: string;
  rewardCreditsPerInvite: number;
  totalInvites: number;
  totalRewarded: number;
  totalRewardedAmount: number;
}

export interface ReferralHistoryItem {
  createdAt: Date;
  id: string;
  inviteeEmail?: string | null;
  inviterRewardAmount: number;
  rewardedAt?: Date | null;
  status: ReferralStatusString;
}

export interface TopUpOrderHistoryItem {
  amount: number;
  createdAt: Date;
  credits: number;
  creditsExpiresAt?: Date | null;
  currency: string;
  expiresAt?: Date | null;
  externalOrderId?: string | null;
  id: string;
  paidAt?: Date | null;
  provider?: string | null;
  redemptionCodeId?: string | null;
  refundAmount?: number | null;
  refundedAt?: Date | null;
  refundReference?: string | null;
  refundStatus?: 'failed' | 'pending' | 'succeeded' | null;
  source?: TopUpOrderSourceType | null;
  status: TopUpOrderStatusType;
}

export interface TopUpPackageItem {
  amount: number;
  credits: number;
  currency: string;
  displayName?: string;
  id: string;
  metadata?: Record<string, unknown> | null;
  recommended?: boolean;
  validityMonths: number;
}

export const QueryCreditLedgerSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type QueryCreditLedgerParams = z.infer<typeof QueryCreditLedgerSchema>;

export const QueryCommercialListSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export type QueryCommercialListParams = z.infer<typeof QueryCommercialListSchema>;

export const UpdateAutoTopUpSettingSchema = z.object({
  enabled: z.boolean(),
  monthlyLimit: z.number().min(0).nullable().optional(),
  targetBalance: z.number().min(0),
  threshold: z.number().min(0),
});

export type UpdateAutoTopUpSettingParams = z.infer<typeof UpdateAutoTopUpSettingSchema>;

export const CreateTopUpOrderSchema = z
  .object({
    credits: z.number().int().min(50_000_000).max(5_000_000_000).optional(),
    packageId: z.string().trim().min(1).optional(),
    redemptionCodeId: z.string().uuid().optional(),
    source: z
      .enum([
        TopUpOrderSourceEnum.Redemption,
        TopUpOrderSourceEnum.Alipay,
        TopUpOrderSourceEnum.WechatPay,
        TopUpOrderSourceEnum.ZPay,
        TopUpOrderSourceEnum.Manual,
      ])
      .optional(),
  })
  .refine((value) => Boolean(value.packageId || value.credits), {
    message: 'TOP_UP_PACKAGE_OR_CREDITS_REQUIRED',
    path: ['packageId'],
  });

export type CreateTopUpOrderParams = z.infer<typeof CreateTopUpOrderSchema>;

export const CancelTopUpOrderSchema = z.object({
  orderId: z.string().uuid(),
});

export type CancelTopUpOrderParams = z.infer<typeof CancelTopUpOrderSchema>;

export const SettleTopUpOrderSchema = z.object({
  orderId: z.string().uuid(),
});

export type SettleTopUpOrderParams = z.infer<typeof SettleTopUpOrderSchema>;

export const CreateSubscriptionChangeRequestSchema = z.object({
  cycle: z.enum([
    SubscriptionCycleEnum.Monthly,
    SubscriptionCycleEnum.Yearly,
    SubscriptionCycleEnum.OneTime,
    SubscriptionCycleEnum.Lifetime,
  ]),
  targetPlan: z.nativeEnum(Plans),
});

export type CreateSubscriptionChangeRequestParams = z.infer<
  typeof CreateSubscriptionChangeRequestSchema
>;

export const ActivateSubscriptionChangeRequestSchema = z.object({
  requestId: z.string().uuid(),
});

export type ActivateSubscriptionChangeRequestParams = z.infer<
  typeof ActivateSubscriptionChangeRequestSchema
>;

export const ReferralCodeSchema = z.string().trim().min(2).max(8).regex(/^\w+$/);

export const UpdateReferralCodeSchema = z.object({
  code: ReferralCodeSchema,
});

export type UpdateReferralCodeParams = z.infer<typeof UpdateReferralCodeSchema>;

export const BindReferralCodeSchema = z.object({
  code: z.string().trim().min(1).max(256),
});

export type BindReferralCodeParams = z.infer<typeof BindReferralCodeSchema>;
