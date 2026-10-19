import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  type BillingOrderHistoryItem,
  type CreditLedgerEntryItem,
  type ReferralHistoryItem,
  type SubscriptionChangeRequestItem,
  type TopUpOrderHistoryItem,
} from '@/types/business';
import { type UsageRecordItem } from '@/types/usage/usageRecord';

import {
  buildBillingChangeRecord,
  buildBillingOrderRecord,
  buildCreditLedgerRecord,
  buildReferralHistoryRecord,
  buildTopUpOrderRecord,
  buildUsageRecord,
  type BusinessRecordFormatters,
} from './businessRecordBuilders';

const createdAt = new Date('2026-07-18T08:00:00.000Z');
const updatedAt = new Date('2026-07-18T09:00:00.000Z');

const formatters: BusinessRecordFormatters = {
  creditLedgerAllocation: (item) => `allocation:${item.id}`,
  creditLedgerDescription: (item) => `description:${item.description}`,
  formatCredits: (value) => `credits:${value}`,
  formatCurrency: (value, currency) => `currency:${value}:${currency}`,
  formatDate: (value) => `date:${value?.toISOString() ?? '--'}`,
  formatNumber: (value, digits) => `number:${value}:${digits ?? 'default'}`,
  formatSignedCredits: (value) => `signed:${value}`,
  t: (key) => `t:${key}`,
};

const labelsOf = (record: ReturnType<typeof buildBillingChangeRecord>) =>
  record.fields.map((field) => field.label);

describe('businessRecordBuilders', () => {
  it('builds every billing change field with localized plan, cycle, reason, and status values', () => {
    const item: SubscriptionChangeRequestItem = {
      createdAt,
      cycle: 'yearly',
      fromPlan: Plans.Starter,
      id: 'change-1',
      reason: 'upgrade',
      status: 'completed',
      toPlan: Plans.Premium,
      updatedAt,
    };

    const record = buildBillingChangeRecord(item, formatters);

    expect(record).toMatchObject({
      status: 't:billing.changeStatus.completed',
      title: 't:plans.plan.starter.title → t:plans.plan.premium.title',
      value: 't:recurring.yearly',
    });
    expect(labelsOf(record)).toEqual([
      't:mobile.records.field.id',
      't:billing.planChangeFrom',
      't:billing.planChangeTo',
      't:billing.planChangeCycle',
      't:admin.reason',
      't:billing.planChangeStatus',
      't:admin.orders.detail.createdAt',
      't:admin.orders.detail.updatedAt',
    ]);
  });

  it('builds every top-up order field with currency, credits, source, and dates', () => {
    const item: TopUpOrderHistoryItem = {
      amount: 29,
      createdAt,
      credits: 300_000_000,
      currency: 'CNY',
      externalOrderId: 'external-1',
      id: 'order-1',
      paidAt: updatedAt,
      provider: 'alipay',
      source: 'redemption',
      status: 'paid',
    };

    const record = buildTopUpOrderRecord(item, formatters);

    expect(record).toMatchObject({
      status: 't:topup.status.paid',
      title: 'credits:300000000',
      value: 'currency:29:CNY',
    });
    expect(record.fields.map((field) => field.label)).toEqual([
      't:admin.orders.detail.orderId',
      't:admin.orders.detail.amount',
      't:admin.orders.detail.credits',
      't:topup.history.source',
      't:admin.orders.col.provider',
      't:admin.orders.detail.externalOrderId',
      't:admin.orders.detail.createdAt',
      't:admin.orders.detail.paidAt',
    ]);
  });

  it('builds unified billing records for subscription orders', () => {
    const item: BillingOrderHistoryItem = {
      amount: 68,
      createdAt,
      currency: 'CNY',
      cycle: 'monthly',
      displayName: 'Starter',
      externalOrderId: 'external-subscription-1',
      id: 'subscription-order-1',
      kind: 'subscription',
      method: 'alipay',
      paidAt: updatedAt,
      plan: Plans.Starter,
      provider: 'alipay',
      status: 'paid',
    };

    const record = buildBillingOrderRecord(item, formatters);

    expect(record).toMatchObject({
      meta: 'date:2026-07-18T09:00:00.000Z',
      status: 't:topup.status.paid',
      title: 'Starter',
      value: 'currency:68:CNY',
    });
    expect(record.fields.map((field) => field.value)).toContain('套餐订阅');
    expect(record.fields.map((field) => field.value)).toContain('Starter');
  });

  it('builds every credit ledger field with dedicated credit formatters', () => {
    const item: CreditLedgerEntryItem = {
      amount: -20_000_000,
      balanceAfter: 650_000_000,
      createdAt,
      description: 'Mobile fixture usage',
      id: 'ledger-1',
      metadata: { source: 'subscription' },
      referenceId: 'message-1',
      referenceType: 'message',
      title: 'AI chat',
      type: 'consume',
    };

    const record = buildCreditLedgerRecord(item, formatters);

    expect(record).toMatchObject({
      status: 't:credits.ledger.type.consume',
      title: 'AI chat',
      value: 'signed:-20000000',
    });
    expect(record.fields.map((field) => field.label)).toEqual([
      't:mobile.records.field.id',
      't:credits.ledger.columns.amount',
      't:credits.ledger.columns.balanceAfter',
      't:credits.ledger.columns.type',
      't:credits.ledger.columns.description',
      't:credits.ledger.allocation',
      't:mobile.records.field.referenceId',
      't:credits.ledger.columns.createdAt',
    ]);
    expect(record.fields.map((field) => field.value)).toContain('allocation:ledger-1');
    expect(record.fields.map((field) => field.value)).toContain('description:Mobile fixture usage');
  });

  it('builds every referral history field and falls back to a masked id', () => {
    const item: ReferralHistoryItem = {
      createdAt,
      id: 'referral-12345678',
      inviterRewardAmount: 50_000_000,
      rewardedAt: updatedAt,
      status: 'rewarded',
    };

    const record = buildReferralHistoryRecord(item, formatters);

    expect(record).toMatchObject({
      status: 't:referral.table.status.rewarded',
      title: 'refe...5678',
      value: 'credits:50000000',
    });
    expect(record.fields.map((field) => field.label)).toEqual([
      't:mobile.records.field.id',
      't:referral.table.columns.inviteeEmail',
      't:referral.table.columns.status',
      't:referral.table.columns.inviterRewardAmount',
      't:referral.table.columns.createdAt',
      't:referral.table.columns.rewardedAt',
    ]);
  });

  it('builds every usage field with token, performance, spend, and date formatters', () => {
    const item: UsageRecordItem = {
      credits: 350_000,
      createdAt,
      id: 'usage-1',
      model: 'gpt-mobile-fixture',
      provider: 'openai',
      spend: 0.012345,
      totalInputTokens: 1200,
      totalOutputTokens: 300,
      totalTokens: 1500,
      tps: 22.5,
      ttft: 640,
      type: 'chat',
      updatedAt,
      userId: 'user-1',
    };

    const record = buildUsageRecord(item, formatters);

    expect(record).toMatchObject({
      meta: 'date:2026-07-18T08:00:00.000Z',
      status: 't:usage.type.chat',
      title: 'gpt-mobile-fixture',
      value: 'credits:350000',
    });
    expect(record.fields.map((field) => field.label)).toEqual([
      't:mobile.records.field.id',
      't:mobile.records.field.provider',
      't:usage.table.model',
      't:usage.table.type',
      't:usage.table.inputTokens',
      't:usage.table.outputTokens',
      't:mobile.records.field.totalTokens',
      't:usage.table.tps',
      't:usage.table.ttft',
      't:mobile.usage.records.credits',
      't:usage.table.spend',
      't:usage.table.createdAt',
    ]);
    expect(record.fields.map((field) => field.value)).toEqual([
      'usage-1',
      'openai',
      'gpt-mobile-fixture',
      't:usage.type.chat',
      'number:1200:default',
      'number:300:default',
      'number:1500:default',
      'number:22.5:2',
      'number:0.64:2',
      'credits:350000',
      'currency:0.012345:undefined',
      'date:2026-07-18T08:00:00.000Z',
    ]);
  });
});
