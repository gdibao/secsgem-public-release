import { type ReactNode } from 'react';

import {
  type BillingOrderHistoryItem,
  type CreditLedgerEntryItem,
  type CreditPackageHistoryItem,
  type ReferralHistoryItem,
  type SubscriptionChangeRequestItem,
  type TopUpOrderHistoryItem,
} from '@/types/business';
import { type UsageRecordItem } from '@/types/usage/usageRecord';

import { type BusinessMobileRecord } from './BusinessMobileRecordList';

export interface BusinessRecordFormatters {
  creditLedgerAllocation: (item: CreditLedgerEntryItem) => string | undefined;
  creditLedgerDescription: (item: CreditLedgerEntryItem) => string;
  formatCredits: (value: number) => string;
  formatCurrency: (value: number, currency?: string | null) => string;
  formatDate: (value?: Date | null) => string;
  formatNumber: (value?: number | null, digits?: number) => string;
  formatSignedCredits: (value: number) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const fallback = (value?: ReactNode | null): ReactNode =>
  value === undefined || value === null || value === '' ? '--' : value;

const creditTypeKey = (type: CreditLedgerEntryItem['type']) => {
  const keys: Record<CreditLedgerEntryItem['type'], string> = {
    adjustment: 'credits.ledger.type.adjustment',
    bonus: 'credits.ledger.type.bonus',
    consume: 'credits.ledger.type.consume',
    expire: 'credits.ledger.type.expire',
    referral_reward: 'credits.ledger.type.referralReward',
    refund: 'credits.ledger.type.refund',
    subscription_grant: 'credits.ledger.type.subscriptionGrant',
    topup: 'credits.ledger.type.topUp',
  };

  return keys[type] || 'credits.ledger.type.other';
};

const usageTypeKey = (type: string) =>
  `usage.type.${type === 'structured_output' ? 'structuredOutput' : type}`;

export const buildBillingChangeRecord = (
  item: SubscriptionChangeRequestItem,
  formatters: Pick<BusinessRecordFormatters, 'formatDate' | 't'>,
): BusinessMobileRecord => {
  const fromPlan = formatters.t(`plans.plan.${item.fromPlan}.title`);
  const toPlan = formatters.t(`plans.plan.${item.toPlan}.title`);
  const cycle = formatters.t(`recurring.${item.cycle}`);
  const reason = formatters.t(`billing.changeReason.${item.reason}`);
  const status = formatters.t(`billing.changeStatus.${item.status}`);

  return {
    fields: [
      { label: formatters.t('mobile.records.field.id'), value: item.id },
      { label: formatters.t('billing.planChangeFrom'), value: fromPlan },
      { label: formatters.t('billing.planChangeTo'), value: toPlan },
      { label: formatters.t('billing.planChangeCycle'), value: cycle },
      { label: formatters.t('admin.reason'), value: reason },
      { label: formatters.t('billing.planChangeStatus'), value: status },
      {
        label: formatters.t('admin.orders.detail.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
      {
        label: formatters.t('admin.orders.detail.updatedAt'),
        value: formatters.formatDate(item.updatedAt),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status,
    title: `${fromPlan} → ${toPlan}`,
    value: cycle,
  };
};

export const buildTopUpOrderRecord = (
  item: TopUpOrderHistoryItem,
  formatters: Pick<
    BusinessRecordFormatters,
    'formatCredits' | 'formatCurrency' | 'formatDate' | 't'
  >,
): BusinessMobileRecord => {
  const amount = formatters.formatCurrency(item.amount, item.currency);
  const credits = formatters.formatCredits(item.credits);
  const source = item.source ? formatters.t(`topup.source.${item.source}`) : '--';
  const status = formatters.t(`topup.status.${item.status}`);

  return {
    fields: [
      { label: formatters.t('admin.orders.detail.orderId'), value: item.id },
      { label: formatters.t('admin.orders.detail.amount'), value: amount },
      { label: formatters.t('admin.orders.detail.credits'), value: credits },
      { label: formatters.t('topup.history.source'), value: source },
      { label: formatters.t('admin.orders.col.provider'), value: fallback(item.provider) },
      {
        label: formatters.t('admin.orders.detail.externalOrderId'),
        value: fallback(item.externalOrderId),
      },
      {
        label: formatters.t('admin.orders.detail.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
      {
        label: formatters.t('admin.orders.detail.paidAt'),
        value: formatters.formatDate(item.paidAt),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status,
    title: credits,
    value: amount,
  };
};

export const buildBillingOrderRecord = (
  item: BillingOrderHistoryItem,
  formatters: Pick<
    BusinessRecordFormatters,
    'formatCredits' | 'formatCurrency' | 'formatDate' | 't'
  >,
): BusinessMobileRecord => {
  const amount = formatters.formatCurrency(item.amount, item.currency);
  const status = formatters.t('topup.status.' + item.status);
  const isSubscription = item.kind === 'subscription';
  const type = isSubscription ? '套餐订阅' : '积分充值';
  const title = isSubscription
    ? fallback(item.displayName)
    : formatters.formatCredits(item.credits ?? 0);

  return {
    fields: [
      { label: formatters.t('admin.orders.detail.orderId'), value: item.id },
      { label: '类型', value: type },
      { label: '状态', value: status },
      { label: formatters.t('admin.orders.detail.amount'), value: amount },
      {
        label: formatters.t('admin.orders.detail.paidAt'),
        value: formatters.formatDate(item.paidAt),
      },
      {
        label: formatters.t('admin.orders.detail.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
      { label: '商品', value: title },
      ...(isSubscription
        ? [
            { label: '套餐', value: fallback(item.plan) },
            { label: '周期', value: fallback(item.cycle) },
          ]
        : [{ label: '积分', value: formatters.formatCredits(item.credits ?? 0) }]),
      { label: formatters.t('admin.orders.col.provider'), value: fallback(item.provider) },
      {
        label: formatters.t('admin.orders.detail.externalOrderId'),
        value: fallback(item.externalOrderId),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.paidAt ?? item.createdAt),
    status,
    title,
    value: amount,
  };
};

export const buildCreditLedgerRecord = (
  item: CreditLedgerEntryItem,
  formatters: Pick<
    BusinessRecordFormatters,
    | 'creditLedgerAllocation'
    | 'creditLedgerDescription'
    | 'formatCredits'
    | 'formatDate'
    | 'formatSignedCredits'
    | 't'
  >,
): BusinessMobileRecord => {
  const allocation = formatters.creditLedgerAllocation(item);
  const amount = formatters.formatSignedCredits(item.amount);
  const description = formatters.creditLedgerDescription(item);
  const status = formatters.t(creditTypeKey(item.type));

  return {
    fields: [
      { label: formatters.t('mobile.records.field.id'), value: item.id },
      { label: formatters.t('credits.ledger.columns.amount'), value: amount },
      {
        label: formatters.t('credits.ledger.columns.balanceAfter'),
        value: formatters.formatCredits(item.balanceAfter),
      },
      { label: formatters.t('credits.ledger.columns.type'), value: status },
      { label: formatters.t('credits.ledger.columns.description'), value: description },
      {
        label: formatters.t('credits.ledger.allocation', { sources: '' }),
        value: fallback(allocation),
      },
      {
        label: formatters.t('mobile.records.field.referenceId'),
        value: fallback(item.referenceId),
      },
      {
        label: formatters.t('credits.ledger.columns.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status,
    title: item.title || item.referenceType || '--',
    value: amount,
  };
};

export const buildCreditPackageRecord = (
  item: CreditPackageHistoryItem,
  formatters: Pick<BusinessRecordFormatters, 'formatCredits' | 'formatDate' | 't'>,
): BusinessMobileRecord => {
  const status = formatters.t(`credits.packages.tabs.${item.status}`);
  const sourceKeys = {
    other: 'credits.account.breakdown.other',
    referral: 'credits.account.breakdown.referral',
    subscription: 'credits.account.breakdown.subscription',
    topup: 'credits.account.breakdown.topUp',
  } as const;

  return {
    fields: [
      { label: formatters.t('mobile.records.field.id'), value: item.id },
      { label: '来源', value: formatters.t(sourceKeys[item.source]) },
      { label: '积分包', value: formatters.formatCredits(item.grantedAmount) },
      { label: '剩余积分', value: formatters.formatCredits(item.remainingAmount) },
      { label: '获得时间', value: formatters.formatDate(item.createdAt) },
      { label: '有效期至', value: formatters.formatDate(item.expiresAt) },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status,
    title: formatters.formatCredits(item.grantedAmount),
    value: formatters.formatCredits(item.remainingAmount),
  };
};

export const buildReferralHistoryRecord = (
  item: ReferralHistoryItem,
  formatters: Pick<BusinessRecordFormatters, 'formatCredits' | 'formatDate' | 't'>,
): BusinessMobileRecord => {
  const reward = formatters.formatCredits(item.inviterRewardAmount);
  const status = formatters.t(`referral.table.status.${item.status}`);
  const maskedId = item.id.length > 8 ? `${item.id.slice(0, 4)}...${item.id.slice(-4)}` : item.id;

  return {
    fields: [
      { label: formatters.t('mobile.records.field.id'), value: item.id },
      {
        label: formatters.t('referral.table.columns.inviteeEmail'),
        value: fallback(item.inviteeEmail),
      },
      { label: formatters.t('referral.table.columns.status'), value: status },
      { label: formatters.t('referral.table.columns.inviterRewardAmount'), value: reward },
      {
        label: formatters.t('referral.table.columns.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
      {
        label: formatters.t('referral.table.columns.rewardedAt'),
        value: formatters.formatDate(item.rewardedAt),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status,
    title: item.inviteeEmail || maskedId,
    value: reward,
  };
};

export const buildUsageRecord = (
  item: UsageRecordItem,
  formatters: Pick<
    BusinessRecordFormatters,
    'formatCredits' | 'formatCurrency' | 'formatDate' | 'formatNumber' | 't'
  >,
): BusinessMobileRecord => {
  const credits = formatters.formatCredits(item.credits ?? 0);
  const spend = formatters.formatCurrency(item.spend);
  const type = formatters.t(usageTypeKey(item.type));

  return {
    fields: [
      { label: formatters.t('mobile.records.field.id'), value: item.id },
      { label: formatters.t('mobile.records.field.provider'), value: item.provider },
      { label: formatters.t('usage.table.model'), value: item.model },
      { label: formatters.t('usage.table.type'), value: type },
      {
        label: formatters.t('usage.table.inputTokens'),
        value: formatters.formatNumber(item.totalInputTokens),
      },
      {
        label: formatters.t('usage.table.outputTokens'),
        value: formatters.formatNumber(item.totalOutputTokens),
      },
      {
        label: formatters.t('mobile.records.field.totalTokens'),
        value: formatters.formatNumber(item.totalTokens),
      },
      { label: formatters.t('usage.table.tps'), value: formatters.formatNumber(item.tps, 2) },
      {
        label: formatters.t('usage.table.ttft'),
        value:
          item.ttft === undefined || item.ttft === null
            ? '--'
            : formatters.formatNumber(item.ttft / 1000, 2),
      },
      { label: formatters.t('mobile.usage.records.credits'), value: credits },
      { label: formatters.t('usage.table.spend'), value: spend },
      {
        label: formatters.t('usage.table.createdAt'),
        value: formatters.formatDate(item.createdAt),
      },
    ],
    id: item.id,
    meta: formatters.formatDate(item.createdAt),
    status: type,
    title: item.model,
    value: credits,
  };
};
