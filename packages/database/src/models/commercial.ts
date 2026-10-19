import { CREDITS_PER_DOLLAR, DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';
import type {
  AdminDependencyImpact,
  AiUsagePricingRule,
  AutoTopUpSetting,
  BillingOrderHistoryItem,
  CommercialOverview,
  CommercialResourceUsage,
  CreateSubscriptionChangeRequestParams,
  CreateTopUpOrderParams,
  CreditAccountSummary,
  CreditConsumeAllocation,
  CreditLedgerListResult,
  CreditPackageHistoryItem,
  CreditSourceSummary,
  CreditSourceType,
  ModuleAppNormalizedPaymentEvent,
  PaymentCheckoutAction,
  PaymentMethodId,
  PaymentProvider,
  QueryCommercialListParams,
  QueryCreditLedgerParams,
  ReferralHistoryItem,
  ReferralOverview,
  SubscriptionChangeRequestItem,
  SubscriptionChangeRequestReasonType,
  SubscriptionCycleType,
  SubscriptionEntitlementSnapshot,
  SubscriptionPaymentOrderSnapshot,
  SubscriptionSummary,
  TopUpOrderHistoryItem,
  TopUpPackageItem,
} from '@lobechat/types';
import {
  aiUsagePricingRulesSchema,
  Plans,
  subscriptionEntitlementSnapshotSchema,
  subscriptionPaymentOrderSnapshotSchema,
} from '@lobechat/types';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import {
  appSettings,
  creditAccounts,
  creditLedgerEntries,
  creditLots,
  planCatalog,
  redemptionCodes,
  referralProfiles,
  referralRelations,
  referralRewards,
  subscriptionChangeRequests,
  subscriptionPaymentOrders,
  topUpOrders,
  userPlanSnapshots,
  users,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { addCalendarMonths, addCalendarYears } from './commercial/calendar';
import { CreditLotModel } from './commercial/creditLot';
import { buildCommercialResourceUsage } from './commercial/resourceUsage';
import { CommercialTopUpModel } from './commercial/topUp';
import { EmbeddingModel } from './embedding';
import { FileModel } from './file';

const FREE_SUBSCRIPTION_SUMMARY: SubscriptionSummary = {
  currency: 'USD',
  cycle: 'monthly',
  currentCyclePrice: 0,
  endsAt: null,
  externalSubscriptionId: null,
  isFreePlan: true,
  monthlyCredits: 0,
  monthlyPrice: 0,
  plan: Plans.Free,
  provider: null,
  renewsAt: null,
  startedAt: null,
  status: 'active',
};

const REFERRAL_BACKFILL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const REFERRAL_PREVIEW_REWARD_CREDITS = 100 * CREDITS_PER_DOLLAR;
const REFERRAL_CODE_LENGTH = 7;
const CREDIT_SOURCE_PRIORITY: CreditSourceType[] = ['subscription', 'referral', 'topup', 'other'];
const PRICING_CREDIT_MULTIPLIER_KEY = 'pricing.creditMultiplier';
const PRICING_MODEL_RULES_KEY = 'pricing.modelRules';
const REFERRAL_REWARD_CREDITS_KEY = 'referral.rewardCredits';

const getPlanMetadataNumber = (metadata: unknown, key: string) => {
  const raw =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)[key]
      : null;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0;

  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const parseAiUsagePricingRules = (value: unknown): AiUsagePricingRule[] =>
  aiUsagePricingRulesSchema.parse(value ?? []);

export type AiUsageRouteMetadata = {
  groupKey?: string | null;
  groupMultiplier?: number | null;
  groupName?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
  providerType?: string | null;
};

export type AiUsageCreditQuote = {
  amount: number;
  creditsPerDollar: number;
  matchedPricingRule: AiUsagePricingRule | null;
  pricingMultiplier: number;
  usdCost: number;
};

export const resolveAiUsagePricing = ({
  globalMultiplier,
  groupKey,
  groupMultiplier,
  instanceId,
  model,
  provider,
  providerType,
  rules,
}: {
  globalMultiplier?: number;
  groupKey?: string | null;
  groupMultiplier?: number | null;
  instanceId?: string | null;
  model: string;
  provider: string;
  providerType?: string | null;
  rules: AiUsagePricingRule[];
}) => {
  const normalizedGroup = groupKey?.trim().toLowerCase();
  const normalizedInstanceId = instanceId?.trim().toLowerCase();
  const normalizedModel = model.toLowerCase();
  const normalizedProvider = provider.toLowerCase();
  const normalizedProviderType = providerType?.trim().toLowerCase();
  const matchedRule = rules
    .filter((rule) => {
      const ruleGroup = rule?.group?.trim().toLowerCase();
      const ruleInstanceId = rule?.instanceId?.trim().toLowerCase();
      const ruleModel = rule?.model?.trim().toLowerCase();
      const ruleProvider = rule?.provider?.trim().toLowerCase();
      const ruleProviderType = rule?.providerType?.trim().toLowerCase();
      const groupMatched = ruleGroup ? ruleGroup === normalizedGroup : true;
      const instanceMatched = ruleInstanceId ? ruleInstanceId === normalizedInstanceId : true;
      const modelMatched = !ruleModel || ruleModel === '*' || ruleModel === normalizedModel;
      const providerMatched =
        !ruleProvider || ruleProvider === '*' || ruleProvider === normalizedProvider;
      const providerTypeMatched = ruleProviderType
        ? ruleProviderType === normalizedProviderType
        : true;

      return (
        groupMatched && instanceMatched && modelMatched && providerMatched && providerTypeMatched
      );
    })
    .sort((a, b) => {
      const score = (rule: AiUsagePricingRule) =>
        (rule.instanceId ? 8 : 0) +
        (rule.group ? 4 : 0) +
        (rule.providerType ? 3 : 0) +
        (rule.provider && rule.provider !== '*' ? 2 : 0) +
        (rule.model && rule.model !== '*' ? 2 : 0) +
        (Number.isFinite(rule.creditsPerDollar) ? 1 : 0);

      return score(b) - score(a);
    })[0];

  return {
    creditsPerDollar: matchedRule?.creditsPerDollar,
    matchedRule,
    multiplier:
      (Number.isFinite(globalMultiplier) && Number(globalMultiplier) > 0
        ? Number(globalMultiplier)
        : DEFAULT_PRICING_CREDIT_MULTIPLIER) *
      (Number.isFinite(matchedRule?.multiplier) ? Number(matchedRule?.multiplier) : 1) *
      (Number.isFinite(groupMultiplier) && Number(groupMultiplier) > 0
        ? Number(groupMultiplier)
        : 1),
  };
};

const SUBSCRIPTION_PLAN_ORDER = [
  Plans.Free,
  Plans.Hobby,
  Plans.Starter,
  Plans.Premium,
  Plans.Ultimate,
];

const normalizeReferralCodeValue = (value: string) =>
  value.replaceAll(/\D/g, '').slice(0, REFERRAL_CODE_LENGTH);

const isValidReferralCode = (value: string) => /^\d{7}$/.test(value);

const generateReferralCodeValue = () =>
  String(Math.floor(Math.random() * 10_000_000)).padStart(REFERRAL_CODE_LENGTH, '0');

const extractReferralCodeValue = (value: string) => {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('ref');
    if (fromQuery) return normalizeReferralCodeValue(fromQuery);
  } catch {
    /* empty */
  }

  return normalizeReferralCodeValue(trimmed);
};

const isUniqueViolationError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '23505';

type CreditBreakdown = Record<CreditSourceType, CreditSourceSummary>;

type CreditLedgerReplayEntry = Pick<
  typeof creditLedgerEntries.$inferSelect,
  'amount' | 'id' | 'metadata' | 'type'
>;

const createEmptyCreditSourceSummary = (): CreditSourceSummary => ({
  available: 0,
  consumed: 0,
  credited: 0,
});

const createEmptyCreditBreakdown = (): CreditBreakdown => ({
  other: createEmptyCreditSourceSummary(),
  referral: createEmptyCreditSourceSummary(),
  subscription: createEmptyCreditSourceSummary(),
  topup: createEmptyCreditSourceSummary(),
});

const isCreditSourceType = (value: unknown): value is CreditSourceType =>
  typeof value === 'string' && CREDIT_SOURCE_PRIORITY.includes(value as CreditSourceType);

const normalizeNonNegativeQuota = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;

  const quota = Number(value);
  if (!Number.isFinite(quota) || quota < 0) return null;

  return Math.floor(quota);
};

const normalizePlanResourceQuotas = (metadata?: Record<string, unknown> | null) => {
  const storageQuotaBytes = normalizeNonNegativeQuota(metadata?.storageQuotaBytes);
  const storageQuotaMb = normalizeNonNegativeQuota(metadata?.storageQuotaMb);

  return {
    storageQuota:
      storageQuotaBytes ??
      (storageQuotaMb === null ? null : Math.floor(storageQuotaMb * 1024 * 1024)),
    vectorQuota: normalizeNonNegativeQuota(metadata?.vectorQuota),
  };
};

const getSnapshotMetadata = (metadata: unknown): Record<string, unknown> | null =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;

const getEntitlementSnapshot = (metadata: unknown) => {
  const entitlementSnapshot = getSnapshotMetadata(metadata)?.entitlementSnapshot;
  if (entitlementSnapshot === undefined) return null;

  return subscriptionEntitlementSnapshotSchema.parse(entitlementSnapshot);
};

const buildPlanEntitlementSnapshot = (
  catalog: typeof planCatalog.$inferSelect,
): SubscriptionEntitlementSnapshot => {
  const planMetadata = getSnapshotMetadata(catalog.metadata);
  const quotas = normalizePlanResourceQuotas(planMetadata);

  return subscriptionEntitlementSnapshotSchema.parse({
    catalogUpdatedAt: catalog.updatedAt.toISOString(),
    features: catalog.features,
    modelRules:
      catalog.modelRules && typeof catalog.modelRules === 'object' ? catalog.modelRules : null,
    planMetadata,
    pptCreditCost: normalizeNonNegativeQuota(planMetadata?.pptCreditCost) ?? 0,
    pptEnabled: planMetadata?.pptEnabled === true,
    pptMonthlyQuota: normalizeNonNegativeQuota(planMetadata?.pptMonthlyQuota),
    storageQuotaBytes: quotas.storageQuota,
    vectorQuota: quotas.vectorQuota,
    version: 2,
  });
};

const toEntitlementSnapshot = (
  snapshot: SubscriptionPaymentOrderSnapshot,
): SubscriptionEntitlementSnapshot =>
  subscriptionEntitlementSnapshotSchema.parse({
    catalogUpdatedAt: snapshot.catalogUpdatedAt,
    ...(snapshot.version === 2
      ? {
          features: snapshot.features,
          pptCreditCost: snapshot.pptCreditCost,
          pptEnabled: snapshot.pptEnabled,
          pptMonthlyQuota: snapshot.pptMonthlyQuota,
          storageQuotaBytes: snapshot.storageQuotaBytes,
          vectorQuota: snapshot.vectorQuota,
          version: 2 as const,
        }
      : { version: 1 as const }),
    modelRules: snapshot.modelRules,
    planMetadata: snapshot.planMetadata,
  });

export const getPlanDeleteImpact = async (
  db: LobeChatDatabase | Transaction,
  plan: string,
): Promise<AdminDependencyImpact> => {
  const [target, activeSnapshots, redemptionCodeRows, pendingChangeRequests] = await Promise.all([
    db.query.planCatalog.findFirst({
      columns: { displayName: true, plan: true },
      where: eq(planCatalog.plan, plan as Plans),
    }),
    db
      .select({ value: count() })
      .from(userPlanSnapshots)
      .where(
        and(eq(userPlanSnapshots.plan, plan as Plans), eq(userPlanSnapshots.status, 'active')),
      ),
    db
      .select({ value: count() })
      .from(redemptionCodes)
      .where(and(eq(redemptionCodes.rewardType, 'plan'), eq(redemptionCodes.planKey, plan))),
    db
      .select({ value: count() })
      .from(subscriptionChangeRequests)
      .where(
        and(
          eq(subscriptionChangeRequests.status, 'pending'),
          or(
            eq(subscriptionChangeRequests.fromPlan, plan as Plans),
            eq(subscriptionChangeRequests.toPlan, plan as Plans),
          ),
        ),
      ),
  ]);
  const dependencyCounts = {
    activeSnapshots: Number(activeSnapshots[0]?.value ?? 0),
    pendingChangeRequests: Number(pendingChangeRequests[0]?.value ?? 0),
    redemptionCodes: Number(redemptionCodeRows[0]?.value ?? 0),
  };
  const blocking = [
    {
      code: 'PLAN_ACTIVE_SNAPSHOTS',
      count: dependencyCounts.activeSnapshots,
      title: 'Active subscription snapshots',
    },
    {
      code: 'PLAN_REDEMPTION_CODES',
      count: dependencyCounts.redemptionCodes,
      title: 'Redemption codes',
    },
    {
      code: 'PLAN_PENDING_CHANGE_REQUESTS',
      count: dependencyCounts.pendingChangeRequests,
      title: 'Pending subscription changes',
    },
  ].filter((item) => item.count > 0);

  return {
    blocking,
    canProceed: Boolean(target) && blocking.length === 0,
    immediateEffects: target
      ? [{ code: 'PLAN_CATALOG_DELETE', count: 1, title: 'Plan catalog record removed' }]
      : [],
    liveEffects: target
      ? [{ code: 'PLAN_NEW_ASSIGNMENTS_STOP', count: 1, title: 'New assignments stop immediately' }]
      : [],
    target: { id: plan, label: target?.displayName ?? plan, type: 'plan' },
    targetExists: Boolean(target),
  };
};

export class CommercialModel {
  private readonly db: LobeChatDatabase;
  private readonly topUp: CommercialTopUpModel;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.topUp = new CommercialTopUpModel(db, userId);
  }

  private resolveReferralRewardCredits = async (db: LobeChatDatabase | Transaction = this.db) => {
    const row = await db.query.appSettings.findFirst({
      columns: { value: true },
      extras: {
        valueType: sql<string>`jsonb_typeof(${appSettings.value})`.as('value_type'),
      },
      where: eq(appSettings.key, REFERRAL_REWARD_CREDITS_KEY),
    });
    const configuredReward = row?.value;

    return row?.valueType === 'number' &&
      typeof configuredReward === 'number' &&
      Number.isFinite(configuredReward) &&
      configuredReward > 0
      ? configuredReward
      : REFERRAL_PREVIEW_REWARD_CREDITS;
  };

  ensureCreditAccount = async (db: LobeChatDatabase | Transaction = this.db) => {
    return db.insert(creditAccounts).values({ userId: this.userId }).onConflictDoNothing();
  };

  syncActivePlanResourceQuotas = async (db: LobeChatDatabase | Transaction = this.db) => {
    const now = new Date();
    const activeSnapshot = await db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(
        eq(userPlanSnapshots.userId, this.userId),
        eq(userPlanSnapshots.status, 'active'),
        or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
      ),
    });

    if (!activeSnapshot) return null;

    await this.syncPlanResourceQuotasForSnapshot(activeSnapshot, db);

    return activeSnapshot.plan;
  };

  private ensureCreditAccountForUser = async (
    userId: string,
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    return db.insert(creditAccounts).values({ userId }).onConflictDoNothing();
  };

  private lockCommercialUserForUpdate = async (tx: Transaction) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, this.userId))
      .for('update');

    if (!user) throw new Error('COMMERCIAL_USER_NOT_FOUND');
  };

  private assertSubscriptionPaymentOrderIsLatest = async (
    order: Pick<typeof subscriptionPaymentOrders.$inferSelect, 'activatedSnapshotId' | 'id'>,
    db: LobeChatDatabase | Transaction,
  ) => {
    if (!order.activatedSnapshotId) return;
    const snapshot = await db.query.userPlanSnapshots.findFirst({
      columns: { metadata: true },
      where: and(
        eq(userPlanSnapshots.id, order.activatedSnapshotId),
        eq(userPlanSnapshots.userId, this.userId),
      ),
    });
    const latestPaymentOrderId = getSnapshotMetadata(snapshot?.metadata)?.lastPaymentOrderId;
    if (typeof latestPaymentOrderId === 'string' && latestPaymentOrderId !== order.id) {
      throw new Error('SUBSCRIPTION_PAYMENT_SUPERSEDED_BY_LATER_RENEWAL');
    }
  };

  private lockCreditAccountForUpdate = async (userId: string, tx: Transaction) => {
    await this.ensureCreditAccountForUser(userId, tx);

    const [account] = await tx
      .select({ userId: creditAccounts.userId })
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, userId))
      .for('update');

    if (!account) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');
  };

  private grantCreditsToUser = async ({
    amount,
    description,
    expiresAt,
    metadata,
    referenceId,
    referenceType,
    title,
    tx,
    type,
    userId,
  }: {
    amount: number;
    description?: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
    referenceId?: string;
    referenceType?: string;
    title: string;
    tx: Transaction;
    type: 'referral_reward' | 'subscription_grant' | 'topup';
    userId: string;
  }) => {
    await this.ensureCreditAccountForUser(userId, tx);

    const grantedAt = new Date();
    const [account] = await tx
      .update(creditAccounts)
      .set({
        balance: sql`${creditAccounts.balance} + ${amount}`,
        totalCredited: sql`${creditAccounts.totalCredited} + ${amount}`,
        updatedAt: grantedAt,
      })
      .where(eq(creditAccounts.userId, userId))
      .returning({
        balance: creditAccounts.balance,
      });

    if (!account) {
      throw new Error('CREDIT_ACCOUNT_UPDATE_FAILED');
    }

    const [ledgerEntry] = await tx
      .insert(creditLedgerEntries)
      .values({
        amount,
        balanceAfter: account.balance,
        description,
        metadata,
        referenceId,
        referenceType,
        title,
        type,
        userId,
      })
      .returning({ id: creditLedgerEntries.id });

    if (!ledgerEntry) {
      throw new Error('CREDIT_LEDGER_ENTRY_CREATE_FAILED');
    }

    if (expiresAt && referenceId && referenceType) {
      await new CreditLotModel(this.db, userId).createLot(
        {
          amount,
          expiresAt,
          grantLedgerEntryId: ledgerEntry.id,
          referenceId,
          referenceType,
          source: this.resolveCreditSourceForGrant(type),
        },
        tx,
      );
    }

    return ledgerEntry.id;
  };

  private getChatUsageCreditAmount = (
    usdCost: number,
    pricing: { creditsPerDollar?: number; multiplier?: number } = {},
  ) => {
    if (!Number.isFinite(usdCost) || usdCost <= 0) return 0;

    const creditsPerDollar =
      Number.isFinite(pricing.creditsPerDollar) && Number(pricing.creditsPerDollar) > 0
        ? Number(pricing.creditsPerDollar)
        : CREDITS_PER_DOLLAR;
    const multiplier =
      Number.isFinite(pricing.multiplier) && Number(pricing.multiplier) >= 0
        ? Number(pricing.multiplier)
        : 1;

    return Math.ceil(usdCost * creditsPerDollar * multiplier);
  };

  private getAiUsagePricing = async ({
    groupKey,
    groupMultiplier,
    instanceId,
    model,
    provider,
    providerType,
  }: {
    groupKey?: string | null;
    groupMultiplier?: number | null;
    instanceId?: string | null;
    model: string;
    provider: string;
    providerType?: string | null;
  }) => {
    const rows = await this.db.query.appSettings.findMany({
      where: inArray(appSettings.key, [PRICING_CREDIT_MULTIPLIER_KEY, PRICING_MODEL_RULES_KEY]),
    });
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const configuredGlobalMultiplier = Number(settings[PRICING_CREDIT_MULTIPLIER_KEY]);
    const globalMultiplier =
      Number.isFinite(configuredGlobalMultiplier) && configuredGlobalMultiplier > 0
        ? configuredGlobalMultiplier
        : DEFAULT_PRICING_CREDIT_MULTIPLIER;
    const rules = parseAiUsagePricingRules(settings[PRICING_MODEL_RULES_KEY]);

    return resolveAiUsagePricing({
      globalMultiplier,
      groupKey,
      groupMultiplier,
      instanceId,
      model,
      provider,
      providerType,
      rules,
    });
  };

  private assertSupportedPlan = (plan: string): plan is Plans => {
    if (Object.values(Plans).includes(plan as Plans)) return true;

    throw new Error('SUBSCRIPTION_PLAN_NOT_FOUND');
  };

  private getDefaultPlanDurationMonths = (cycle: SubscriptionCycleType) => {
    switch (cycle) {
      case 'yearly':
      case 'one_time': {
        return 12;
      }
      case 'lifetime': {
        return null;
      }
      default: {
        return 1;
      }
    }
  };

  private resolveRedeemedPlanExpiry = ({
    baseDate,
    cycle,
    durationMonths,
  }: {
    baseDate: Date;
    cycle: SubscriptionCycleType;
    durationMonths?: number | null;
  }) => {
    if (cycle === 'lifetime') return { endsAt: null, renewsAt: null };

    const months =
      durationMonths && durationMonths > 0
        ? durationMonths
        : this.getDefaultPlanDurationMonths(cycle);
    if (!months) return { endsAt: null, renewsAt: null };

    const expiresAt = addCalendarMonths(baseDate, months);
    return { endsAt: expiresAt, renewsAt: expiresAt };
  };

  private resolveCreditSourceForGrant = (type?: string): CreditSourceType => {
    switch (type) {
      case 'subscription_grant': {
        return 'subscription';
      }
      case 'referral_reward': {
        return 'referral';
      }
      case 'topup': {
        return 'topup';
      }
      default: {
        return 'other';
      }
    }
  };

  private cloneCreditBreakdown = (breakdown: CreditBreakdown): CreditBreakdown => ({
    other: { ...breakdown.other },
    referral: { ...breakdown.referral },
    subscription: { ...breakdown.subscription },
    topup: { ...breakdown.topup },
  });

  private sumCreditBreakdownAvailable = (breakdown: CreditBreakdown) =>
    CREDIT_SOURCE_PRIORITY.reduce(
      (total, source) => total + (breakdown[source]?.available ?? 0),
      0,
    );

  private normalizeConsumeAllocations = (value: unknown): CreditConsumeAllocation[] => {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];

      const amount = (item as { amount?: unknown }).amount;
      const source = (item as { source?: unknown }).source;

      if (!Number.isFinite(amount) || Number(amount) <= 0 || !isCreditSourceType(source)) return [];

      return [{ amount: Number(amount), source }];
    });
  };

  private applyConsumeAllocations = ({
    allocations,
    breakdown,
  }: {
    allocations: CreditConsumeAllocation[];
    breakdown: CreditBreakdown;
  }) => {
    for (const allocation of allocations) {
      const summary = breakdown[allocation.source] ?? createEmptyCreditSourceSummary();

      breakdown[allocation.source] = {
        available: summary.available - allocation.amount,
        consumed: summary.consumed + allocation.amount,
        credited: summary.credited,
      };
    }
  };

  private allocateConsumeCredits = ({
    amount,
    breakdown,
  }: {
    amount: number;
    breakdown: CreditBreakdown;
  }): CreditConsumeAllocation[] => {
    const working = this.cloneCreditBreakdown(breakdown);
    const allocations: CreditConsumeAllocation[] = [];
    let remaining = amount;

    for (const source of CREDIT_SOURCE_PRIORITY) {
      if (remaining <= 0) break;

      const available = Math.max(working[source].available, 0);
      if (available <= 0) continue;

      const allocatedAmount = Math.min(available, remaining);
      allocations.push({ amount: allocatedAmount, source });
      working[source].available -= allocatedAmount;
      remaining -= allocatedAmount;
    }

    if (remaining > 0) {
      allocations.push({ amount: remaining, source: 'other' });
    }

    return allocations;
  };

  private consumeTrackedCreditLots = async (
    tx: Transaction,
    allocations: CreditConsumeAllocation[],
  ) => {
    const lotModel = new CreditLotModel(this.db, this.userId);
    const trackedAllocations: CreditConsumeAllocation[] = [];
    for (const allocation of allocations) {
      if (allocation.source !== 'subscription' && allocation.source !== 'topup') continue;
      trackedAllocations.push(
        ...(await lotModel.consumeExpiringLots(tx, allocation.amount, allocation.source)),
      );
    }
    return trackedAllocations;
  };

  allocateAndTrackCreditConsumption = async (input: {
    accountBalance: number;
    amount: number;
    tx: Transaction;
  }) => {
    const breakdown = this.buildCreditBreakdownFromLedger({
      accountBalance: input.accountBalance,
      ledgerEntries: await this.listCreditLedgerReplayEntries(input.tx),
    });
    const allocations = this.allocateConsumeCredits({ amount: input.amount, breakdown });
    const creditLotAllocations = await this.consumeTrackedCreditLots(input.tx, allocations);

    return { allocations, creditLotAllocations };
  };

  private reconcileCreditBreakdown = ({
    balance,
    breakdown,
  }: {
    balance: number;
    breakdown: CreditBreakdown;
  }): CreditBreakdown => {
    const reconciled = this.cloneCreditBreakdown(breakdown);
    const diff = balance - this.sumCreditBreakdownAvailable(reconciled);

    if (diff === 0) return reconciled;

    if (diff > 0) {
      reconciled.other.available += diff;
      reconciled.other.credited += diff;
    } else {
      reconciled.other.available += diff;
      reconciled.other.consumed += Math.abs(diff);
    }

    return reconciled;
  };

  private buildCreditBreakdownFromLedger = ({
    accountBalance,
    ledgerEntries,
  }: {
    accountBalance: number;
    ledgerEntries: CreditLedgerReplayEntry[];
  }): CreditBreakdown => {
    const breakdown = createEmptyCreditBreakdown();

    for (const entry of ledgerEntries) {
      const entryAmount = Number(entry.amount ?? 0);
      if (!Number.isFinite(entryAmount) || entryAmount === 0) continue;

      if (entryAmount > 0) {
        const source = this.resolveCreditSourceForGrant(entry.type);
        const summary = breakdown[source];

        breakdown[source] = {
          available: summary.available + entryAmount,
          consumed: summary.consumed,
          credited: summary.credited + entryAmount,
        };
        continue;
      }

      const consumeAmount = Math.abs(entryAmount);
      const existingAllocations = this.normalizeConsumeAllocations(entry.metadata?.allocations);
      const allocatedAmount = existingAllocations.reduce(
        (total, allocation) => total + allocation.amount,
        0,
      );
      const allocations = [...existingAllocations];
      const previewBreakdown = this.cloneCreditBreakdown(breakdown);

      if (existingAllocations.length > 0) {
        this.applyConsumeAllocations({
          allocations: existingAllocations,
          breakdown: previewBreakdown,
        });
      }

      if (allocatedAmount < consumeAmount) {
        allocations.push(
          ...this.allocateConsumeCredits({
            amount: consumeAmount - allocatedAmount,
            breakdown: previewBreakdown,
          }),
        );
      }

      this.applyConsumeAllocations({ allocations, breakdown });
    }

    return this.reconcileCreditBreakdown({ balance: accountBalance, breakdown });
  };

  private listCreditLedgerReplayEntries = async (
    db: LobeChatDatabase | Transaction = this.db,
  ): Promise<CreditLedgerReplayEntry[]> => {
    return db
      .select({
        amount: creditLedgerEntries.amount,
        id: creditLedgerEntries.id,
        metadata: creditLedgerEntries.metadata,
        type: creditLedgerEntries.type,
      })
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.userId, this.userId))
      .orderBy(asc(creditLedgerEntries.createdAt), asc(creditLedgerEntries.id));
  };

  private listDueSubscriptionGrantPeriods = (
    snapshot?: Pick<
      typeof userPlanSnapshots.$inferSelect,
      'cycle' | 'endsAt' | 'id' | 'monthlyCredits' | 'plan' | 'startedAt' | 'status'
    > | null,
  ) => {
    if (!snapshot) return [];
    if (snapshot.status !== 'active') return [];
    if (snapshot.plan === Plans.Free) return [];
    if (!snapshot.monthlyCredits || snapshot.monthlyCredits <= 0) return [];

    const now = new Date();
    const cutoff = snapshot.endsAt && snapshot.endsAt < now ? snapshot.endsAt : now;
    if (snapshot.startedAt > cutoff) return [];

    const periods: Array<{ index: number; periodStart: Date; referenceId: string }> = [];

    for (let index = 0; ; index += 1) {
      const periodStart = addCalendarMonths(snapshot.startedAt, index);
      if (periodStart > cutoff) break;

      periods.push({
        index,
        periodStart,
        referenceId: `${snapshot.id}:${index}`,
      });
    }

    return periods;
  };

  private syncSubscriptionCreditsForSnapshot = async ({
    snapshot,
    tx,
  }: {
    snapshot?: Pick<
      typeof userPlanSnapshots.$inferSelect,
      'cycle' | 'endsAt' | 'id' | 'metadata' | 'monthlyCredits' | 'plan' | 'startedAt' | 'status'
    > | null;
    tx: Transaction;
  }) => {
    if (!snapshot) return { grantedCount: 0, grantedLotReferenceIds: [] as string[] };

    await this.syncPlanResourceQuotasForSnapshot(snapshot, tx);

    const duePeriods = this.listDueSubscriptionGrantPeriods(snapshot);
    if (duePeriods.length === 0) {
      return { grantedCount: 0, grantedLotReferenceIds: [] as string[] };
    }

    await this.lockCreditAccountForUpdate(this.userId, tx);

    // Batch-fetch existing referenceIds to avoid N+1 queries
    const existingEntries = await tx
      .select({ referenceId: creditLedgerEntries.referenceId })
      .from(creditLedgerEntries)
      .where(
        and(
          eq(creditLedgerEntries.userId, this.userId),
          eq(creditLedgerEntries.type, 'subscription_grant'),
          eq(creditLedgerEntries.referenceType, 'subscription_snapshot_period'),
          inArray(
            creditLedgerEntries.referenceId,
            duePeriods.map((p) => p.referenceId),
          ),
        ),
      );

    const existingReferenceIds = new Set(existingEntries.map((e) => e.referenceId));

    let granted = 0;
    const grantedLotReferenceIds: string[] = [];

    for (const period of duePeriods) {
      if (existingReferenceIds.has(period.referenceId)) continue;

      await this.grantCreditsToUser({
        amount: snapshot.monthlyCredits,
        description: `Granted ${snapshot.plan} subscription credits for period #${period.index + 1}`,
        expiresAt:
          snapshot.endsAt && snapshot.endsAt < addCalendarMonths(period.periodStart, 1)
            ? snapshot.endsAt
            : addCalendarMonths(period.periodStart, 1),
        metadata: {
          cycle: snapshot.cycle,
          periodIndex: period.index,
          periodStart: period.periodStart.toISOString(),
          plan: snapshot.plan,
          previewMode: true,
          snapshotId: snapshot.id,
        },
        referenceId: period.referenceId,
        referenceType: 'subscription_snapshot_period',
        title: 'Subscription Credits',
        tx,
        type: 'subscription_grant',
        userId: this.userId,
      });

      granted += 1;
      grantedLotReferenceIds.push(period.referenceId);
    }

    return { grantedCount: granted, grantedLotReferenceIds };
  };

  private syncPlanResourceQuotasForSnapshot = async (
    snapshot: Pick<typeof userPlanSnapshots.$inferSelect, 'metadata' | 'plan'>,
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    await this.ensureCreditAccount(db);

    const entitlementSnapshot = getEntitlementSnapshot(snapshot.metadata);
    let quotas;
    if (entitlementSnapshot?.version === 2) {
      quotas = {
        storageQuota: entitlementSnapshot.storageQuotaBytes,
        vectorQuota: entitlementSnapshot.vectorQuota,
      };
    } else if (entitlementSnapshot?.version === 1) {
      quotas = normalizePlanResourceQuotas(entitlementSnapshot.planMetadata);
    } else {
      const catalog = await db.query.planCatalog.findFirst({
        where: eq(planCatalog.plan, snapshot.plan as string),
      });
      quotas = normalizePlanResourceQuotas(getSnapshotMetadata(catalog?.metadata));
    }

    await db
      .update(creditAccounts)
      .set({
        storageQuota: quotas.storageQuota,
        updatedAt: new Date(),
        vectorQuota: quotas.vectorQuota,
      })
      .where(eq(creditAccounts.userId, this.userId));
  };

  private syncExpiredPlanSnapshots = async (db: LobeChatDatabase | Transaction = this.db) => {
    const now = new Date();

    await db
      .update(userPlanSnapshots)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
          lt(userPlanSnapshots.endsAt, now),
        ),
      );

    const snapshot = await this.ensureUnlimitedFreePlanSnapshot(db, now);
    if (snapshot) {
      await this.syncPlanResourceQuotasForSnapshot(snapshot, db);
    }

    return snapshot;
  };

  private ensureUnlimitedFreePlanSnapshot = async (
    db: LobeChatDatabase | Transaction = this.db,
    startedAt: Date = new Date(),
  ) => {
    const activeSnapshot = await db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(eq(userPlanSnapshots.userId, this.userId), eq(userPlanSnapshots.status, 'active')),
    });

    if (activeSnapshot) return activeSnapshot;

    const freeCatalog = await db.query.planCatalog.findFirst({
      where: eq(planCatalog.plan, Plans.Free),
    });

    const [freeSnapshot] = await db
      .insert(userPlanSnapshots)
      .values({
        cycle: 'monthly',
        externalSubscriptionId: `default-free-${this.userId}`,
        metadata: {
          ...(freeCatalog
            ? { entitlementSnapshot: buildPlanEntitlementSnapshot(freeCatalog) }
            : {}),
          source: 'subscription_expiry_fallback',
          unlimited: true,
        },
        monthlyCredits: 0,
        monthlyPrice: 0,
        plan: Plans.Free,
        provider: 'system_default',
        startedAt,
        status: 'active',
        userId: this.userId,
      })
      .onConflictDoNothing()
      .returning();

    if (freeSnapshot) return freeSnapshot;

    return db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(eq(userPlanSnapshots.userId, this.userId), eq(userPlanSnapshots.status, 'active')),
    });
  };

  private syncLatestSubscriptionCredits = async () => {
    return this.db.transaction(async (tx) => {
      await this.syncExpiredPlanSnapshots(tx);

      const snapshot = await tx.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
        ),
      });

      return this.syncSubscriptionCreditsForSnapshot({ snapshot, tx });
    });
  };

  canStartChatUsage = async (requiredCredits: number = 1) => {
    await this.syncLatestSubscriptionCredits();
    return this.db.transaction(async (tx) => {
      const lotModel = new CreditLotModel(this.db, this.userId);
      await lotModel.assertNoOpenDebt(tx);
      await lotModel.expireDueLots(tx);
      const account = await tx.query.creditAccounts.findFirst({
        columns: { balance: true },
        where: eq(creditAccounts.userId, this.userId),
      });

      return (account?.balance ?? 0) >= Math.max(1, Math.ceil(requiredCredits));
    });
  };

  preCharge = async (estimatedCredits: number, db: LobeChatDatabase | Transaction = this.db) => {
    const sufficient = await this.canStartChatUsage(estimatedCredits);
    if (!sufficient) {
      throw new Error('InsufficientBudgetForModel');
    }
    await this.ensureCreditAccount(db);
    return { creditAccountId: this.userId };
  };

  postCharge = async (
    params: {
      credits: number;
      metadata?: Record<string, unknown>;
      model: string;
      operationId?: string;
      provider: string;
      referenceId?: string;
      referenceType?: string;
      source: string;
      title?: string;
      userId: string;
    },
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    const creditsAmount = params.credits;

    return db.transaction(async (tx) => {
      await this.lockCreditAccountForUpdate(params.userId, tx);
      const lotModel = new CreditLotModel(this.db, params.userId);

      if (params.referenceId) {
        const existed = await tx.query.creditLedgerEntries.findFirst({
          where: and(
            eq(creditLedgerEntries.userId, params.userId),
            eq(
              creditLedgerEntries.referenceType,
              params.referenceType ?? `${params.source}_generation`,
            ),
            eq(creditLedgerEntries.referenceId, params.referenceId),
            eq(creditLedgerEntries.type, 'consume'),
          ),
        });

        if (existed) return existed;
      }

      await lotModel.assertNoOpenDebt(tx);
      await lotModel.expireDueLots(tx);

      const [accountBefore] = await tx
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, params.userId))
        .for('update');

      if (!accountBefore) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');

      const { allocations, creditLotAllocations } = await this.allocateAndTrackCreditConsumption({
        accountBalance: accountBefore.balance,
        amount: creditsAmount,
        tx,
      });

      const [account] = await tx
        .update(creditAccounts)
        .set({
          balance: sql`${creditAccounts.balance} - ${creditsAmount}`,
          totalDebited: sql`${creditAccounts.totalDebited} + ${creditsAmount}`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(creditAccounts.userId, params.userId), gte(creditAccounts.balance, creditsAmount)),
        )
        .returning({ balance: creditAccounts.balance });

      if (!account) {
        throw new Error('COMMERCIAL_BALANCE_EXHAUSTED_ON_FINAL_CHARGE');
      }

      const [ledgerEntry] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: -creditsAmount,
          balanceAfter: account.balance,
          description: `${params.source} usage: ${params.model}`,
          metadata: {
            ...params.metadata,
            allocations,
            creditLotAllocations,
            model: params.model,
            provider: params.provider,
            source: params.source,
          },
          referenceId: params.referenceId,
          referenceType: params.referenceType ?? `${params.source}_generation`,
          title: params.title ?? `${params.source} Usage`,
          type: 'consume',
          userId: params.userId,
        })
        .returning();

      return ledgerEntry;
    });
  };

  consumeCreditsForChatUsage = async ({
    messageId,
    model,
    operationId,
    provider,
    routeMetadata,
    usage,
  }: {
    messageId: string;
    model: string;
    operationId?: string;
    provider: string;
    routeMetadata?: AiUsageRouteMetadata;
    usage?: {
      cost?: number;
      costSource?: string;
      totalInputTokens?: number;
      totalOutputTokens?: number;
      totalTokens?: number;
    };
  }) => {
    return this.consumeCreditsForAiUsage({
      model,
      operationId,
      provider,
      referenceId: messageId,
      referenceType: 'assistant_message',
      routeMetadata,
      title: 'AI Chat Usage',
      usage,
      usageType: 'chat',
    });
  };

  consumeCreditsForAiUsage = async ({
    model,
    operationId,
    provider,
    referenceId,
    referenceType,
    routeMetadata,
    title = 'AI Usage',
    usage,
    usageType,
  }: {
    model: string;
    operationId?: string;
    provider: string;
    referenceId: string;
    referenceType: string;
    routeMetadata?: AiUsageRouteMetadata;
    title?: string;
    usage?: {
      cost?: number;
      costSource?: string;
      totalInputTokens?: number;
      totalOutputTokens?: number;
      totalTokens?: number;
    };
    usageType: 'asr' | 'chat' | 'embeddings' | 'generate_object';
  }) => {
    const quote = await this.quoteCreditsForAiUsage({
      model,
      provider,
      routeMetadata,
      usage: { cost: usage?.cost ?? 0 },
    });
    const { amount, usdCost } = quote;

    if (amount <= 0) return null;

    await this.syncLatestSubscriptionCredits();

    return this.db.transaction(async (tx) => {
      await this.lockCreditAccountForUpdate(this.userId, tx);
      const lotModel = new CreditLotModel(this.db, this.userId);
      const existed = await tx.query.creditLedgerEntries.findFirst({
        where: and(
          eq(creditLedgerEntries.userId, this.userId),
          eq(creditLedgerEntries.referenceType, referenceType),
          eq(creditLedgerEntries.referenceId, referenceId),
          eq(creditLedgerEntries.type, 'consume'),
        ),
      });

      if (existed) return existed;

      await lotModel.assertNoOpenDebt(tx);
      await lotModel.expireDueLots(tx);
      const accountBefore = await tx
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, this.userId))
        .for('update')
        .then((rows) => rows[0]);

      const { allocations, creditLotAllocations } = await this.allocateAndTrackCreditConsumption({
        accountBalance: accountBefore?.balance ?? 0,
        amount,
        tx,
      });

      const consumedAt = new Date();
      const [account] = await tx
        .update(creditAccounts)
        .set({
          balance: sql`${creditAccounts.balance} - ${amount}`,
          totalDebited: sql`${creditAccounts.totalDebited} + ${amount}`,
          updatedAt: consumedAt,
        })
        .where(and(eq(creditAccounts.userId, this.userId), gte(creditAccounts.balance, amount)))
        .returning({
          balance: creditAccounts.balance,
        });

      if (!account) {
        throw new Error('COMMERCIAL_BALANCE_EXHAUSTED_ON_FINAL_CHARGE');
      }

      const [ledgerEntry] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: -amount,
          balanceAfter: account.balance,
          description: `Consumed on ${provider}/${model}`,
          metadata: {
            allocations,
            billingMode: 'official_raw_credits',
            chargedCredits: amount,
            creditLotAllocations,
            creditsPerDollar: quote.creditsPerDollar,
            ...(usage?.costSource ? { costSource: usage.costSource } : {}),
            ...(routeMetadata?.groupKey ? { groupKey: routeMetadata.groupKey } : {}),
            ...(routeMetadata?.groupMultiplier === null ||
            routeMetadata?.groupMultiplier === undefined
              ? {}
              : { groupMultiplier: routeMetadata.groupMultiplier }),
            ...(routeMetadata?.groupName ? { groupName: routeMetadata.groupName } : {}),
            ...(routeMetadata?.instanceId ? { instanceId: routeMetadata.instanceId } : {}),
            ...(routeMetadata?.instanceName ? { instanceName: routeMetadata.instanceName } : {}),
            ...(routeMetadata?.providerType ? { providerType: routeMetadata.providerType } : {}),
            matchedPricingRule: quote.matchedPricingRule,
            model,
            operationId,
            pricingMultiplier: quote.pricingMultiplier,
            provider,
            totalInputTokens: usage?.totalInputTokens ?? 0,
            totalOutputTokens: usage?.totalOutputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
            usdCost,
            usageType,
          },
          referenceId,
          referenceType,
          title,
          type: 'consume',
          userId: this.userId,
        })
        .returning();

      if (!ledgerEntry) {
        throw new Error('CHAT_USAGE_LEDGER_ENTRY_CREATE_FAILED');
      }

      return ledgerEntry;
    });
  };

  quoteCreditsForAiUsage = async ({
    model,
    provider,
    routeMetadata,
    usage,
  }: {
    model: string;
    provider: string;
    routeMetadata?: AiUsageRouteMetadata;
    usage: { cost?: number };
  }): Promise<AiUsageCreditQuote> => {
    const usdCost = usage.cost ?? 0;
    const pricing = await this.getAiUsagePricing({
      groupKey: routeMetadata?.groupKey,
      groupMultiplier: routeMetadata?.groupMultiplier,
      instanceId: routeMetadata?.instanceId,
      model,
      provider,
      providerType: routeMetadata?.providerType,
    });

    return {
      amount: this.getChatUsageCreditAmount(usdCost, pricing),
      creditsPerDollar: pricing.creditsPerDollar ?? CREDITS_PER_DOLLAR,
      matchedPricingRule: pricing.matchedRule ?? null,
      pricingMultiplier: pricing.multiplier ?? 1,
      usdCost,
    };
  };

  getAutoTopUpSetting = (): Promise<AutoTopUpSetting> => this.topUp.getAutoTopUpSetting();

  listTopUpPackages = (): Promise<TopUpPackageItem[]> => this.topUp.listTopUpPackages();

  private assertReferralBackfillWindow = async () => {
    const user = await this.db.query.users.findFirst({
      columns: { createdAt: true },
      where: eq(users.id, this.userId),
    });

    if (!user?.createdAt) return;

    if (user.createdAt.getTime() + REFERRAL_BACKFILL_WINDOW_MS < Date.now()) {
      throw new Error('REFERRAL_BACKFILL_EXPIRED');
    }
  };

  getReferralProfile = async () => {
    const existing = await this.db.query.referralProfiles.findFirst({
      where: eq(referralProfiles.userId, this.userId),
    });

    if (existing) return existing;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const nextCode = generateReferralCodeValue();

      try {
        const [created] = await this.db
          .insert(referralProfiles)
          .values({ code: nextCode, userId: this.userId })
          .returning();

        if (created) return created;
      } catch (error) {
        if (isUniqueViolationError(error)) {
          const profile = await this.db.query.referralProfiles.findFirst({
            where: eq(referralProfiles.userId, this.userId),
          });

          if (profile) return profile;
          continue;
        }

        throw error;
      }
    }

    throw new Error('REFERRAL_PROFILE_CREATE_FAILED');
  };

  getCreditAccountSummary = async (): Promise<CreditAccountSummary> => {
    await this.syncLatestSubscriptionCredits();
    await this.db.transaction(async (tx) => {
      await new CreditLotModel(this.db, this.userId).expireDueLots(tx);
    });

    const account = await this.db.query.creditAccounts.findFirst({
      where: eq(creditAccounts.userId, this.userId),
    });

    if (!account) {
      return {
        balance: 0,
        breakdown: createEmptyCreditBreakdown(),
        currency: 'CREDITS',
        totalCredited: 0,
        totalDebited: 0,
        updatedAt: null,
      };
    }

    const breakdown = this.buildCreditBreakdownFromLedger({
      accountBalance: account.balance ?? 0,
      ledgerEntries: await this.listCreditLedgerReplayEntries(),
    });

    return {
      balance: account.balance ?? 0,
      breakdown,
      currency: account.currency,
      totalCredited: account.totalCredited ?? 0,
      totalDebited: account.totalDebited ?? 0,
      updatedAt: account.updatedAt,
    };
  };

  listCreditLedger = async (
    params: QueryCreditLedgerParams = {},
  ): Promise<CreditLedgerListResult> => {
    const { cursor, limit = 20 } = params;
    const conditions = [eq(creditLedgerEntries.userId, this.userId)];

    if (cursor) {
      const cursorRow = await this.db
        .select({
          createdAt: creditLedgerEntries.createdAt,
          id: creditLedgerEntries.id,
        })
        .from(creditLedgerEntries)
        .where(and(eq(creditLedgerEntries.id, cursor), eq(creditLedgerEntries.userId, this.userId)))
        .limit(1);

      if (cursorRow[0]) {
        const { createdAt, id } = cursorRow[0];
        conditions.push(
          or(
            lt(creditLedgerEntries.createdAt, createdAt),
            and(eq(creditLedgerEntries.createdAt, createdAt), lt(creditLedgerEntries.id, id)),
          )!,
        );
      }
    }

    const rows = await this.db
      .select({
        amount: creditLedgerEntries.amount,
        balanceAfter: creditLedgerEntries.balanceAfter,
        createdAt: creditLedgerEntries.createdAt,
        description: creditLedgerEntries.description,
        id: creditLedgerEntries.id,
        metadata: creditLedgerEntries.metadata,
        referenceId: creditLedgerEntries.referenceId,
        referenceType: creditLedgerEntries.referenceType,
        title: creditLedgerEntries.title,
        type: creditLedgerEntries.type,
      })
      .from(creditLedgerEntries)
      .where(and(...conditions))
      .orderBy(desc(creditLedgerEntries.createdAt), desc(creditLedgerEntries.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id : undefined,
    };
  };

  listCreditPackages = async (
    params: QueryCommercialListParams = {},
  ): Promise<CreditPackageHistoryItem[]> => {
    const { limit = 100 } = params;

    await this.syncLatestSubscriptionCredits();
    await this.db.transaction(async (tx) => {
      await new CreditLotModel(this.db, this.userId).expireDueLots(tx);
    });

    const rows = await this.db
      .select({
        consumedAmount: creditLots.consumedAmount,
        createdAt: creditLots.createdAt,
        expiredAmount: creditLots.expiredAmount,
        expiresAt: creditLots.expiresAt,
        grantedAmount: creditLots.grantedAmount,
        id: creditLots.id,
        referenceId: creditLots.referenceId,
        referenceType: creditLots.referenceType,
        refundedAmount: creditLots.refundedAmount,
        source: creditLots.source,
        status: creditLots.status,
        updatedAt: creditLots.updatedAt,
      })
      .from(creditLots)
      .where(eq(creditLots.userId, this.userId))
      .orderBy(desc(creditLots.createdAt), desc(creditLots.id))
      .limit(limit);

    return rows.map((row) => {
      const remainingAmount = Math.max(
        0,
        row.grantedAmount - row.consumedAmount - row.expiredAmount - row.refundedAmount,
      );

      return {
        ...row,
        remainingAmount,
        status: row.status === 'expired' ? 'expired' : remainingAmount <= 0 ? 'depleted' : 'active',
      };
    });
  };

  getLatestPlanSnapshot = async (db: LobeChatDatabase | Transaction = this.db) => {
    const now = new Date();

    return db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(
        eq(userPlanSnapshots.userId, this.userId),
        eq(userPlanSnapshots.status, 'active'),
        or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
      ),
    });
  };

  getSubscriptionSummary = async (
    db: LobeChatDatabase | Transaction = this.db,
  ): Promise<SubscriptionSummary> => {
    const snapshot = await this.getLatestPlanSnapshot(db);

    if (!snapshot) return FREE_SUBSCRIPTION_SUMMARY;

    const pricingSnapshot =
      snapshot.metadata &&
      typeof snapshot.metadata === 'object' &&
      !Array.isArray(snapshot.metadata)
        ? (snapshot.metadata as Record<string, unknown>).pricingSnapshot
        : undefined;
    const rawCyclePrice =
      pricingSnapshot && typeof pricingSnapshot === 'object' && !Array.isArray(pricingSnapshot)
        ? (pricingSnapshot as Record<string, unknown>).amount
        : undefined;
    const currentCyclePrice = Number(rawCyclePrice);

    return {
      currency: snapshot.currency,
      cycle: snapshot.cycle,
      currentCyclePrice:
        Number.isFinite(currentCyclePrice) && currentCyclePrice >= 0
          ? currentCyclePrice
          : (snapshot.monthlyPrice ?? 0),
      endsAt: snapshot.endsAt,
      externalSubscriptionId: snapshot.externalSubscriptionId,
      isFreePlan: snapshot.plan === Plans.Free,
      monthlyCredits: snapshot.monthlyCredits ?? 0,
      monthlyPrice: snapshot.monthlyPrice ?? 0,
      plan: snapshot.plan,
      provider: snapshot.provider,
      renewsAt: snapshot.renewsAt,
      startedAt: snapshot.startedAt,
      status: snapshot.status,
    };
  };

  getCommercialOverview = async (): Promise<CommercialOverview> => {
    const [account, subscription] = await Promise.all([
      this.getCreditAccountSummary(),
      this.getSubscriptionSummary(),
    ]);

    return { account, subscription };
  };

  getResourceUsage = async (): Promise<CommercialResourceUsage> => {
    // Resource quotas are copied from the active subscription snapshot. Sync
    // them before reading the account so a direct usage-page visit cannot race
    // the commercial overview request and render an outdated unlimited quota.
    await this.syncLatestSubscriptionCredits();

    const [account, storageUsed, vectorUsed] = await Promise.all([
      this.db.query.creditAccounts.findFirst({
        columns: { storageQuota: true, vectorQuota: true },
        where: eq(creditAccounts.userId, this.userId),
      }),
      new FileModel(this.db, this.userId).countUsage(),
      new EmbeddingModel(this.db, this.userId).countUsage(),
    ]);

    return buildCommercialResourceUsage(account, { storageUsed, vectorUsed });
  };

  getCurrentPlan = async (): Promise<Plans> => {
    const summary = await this.getSubscriptionSummary();
    return summary.plan;
  };

  updateAutoTopUpSetting = async (
    input: Pick<AutoTopUpSetting, 'enabled' | 'monthlyLimit' | 'targetBalance' | 'threshold'>,
  ): Promise<AutoTopUpSetting> => this.topUp.updateAutoTopUpSetting(input, this.getCurrentPlan);

  getPendingSubscriptionChangeRequest = async (
    db: LobeChatDatabase | Transaction = this.db,
  ): Promise<SubscriptionChangeRequestItem | null> => {
    const request = await db.query.subscriptionChangeRequests.findFirst({
      orderBy: [desc(subscriptionChangeRequests.createdAt)],
      where: and(
        eq(subscriptionChangeRequests.userId, this.userId),
        eq(subscriptionChangeRequests.status, 'pending'),
      ),
    });

    return request || null;
  };

  private resolveSubscriptionChangeReason = (
    currentPlan: Plans,
    targetPlan: Plans,
  ): SubscriptionChangeRequestReasonType => {
    const currentIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(currentPlan);
    const targetIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(targetPlan);

    if (targetIndex > currentIndex) return 'upgrade';
    if (targetIndex < currentIndex) return 'downgrade';

    return 'cycle_change';
  };

  private getRequiredPlanCatalogEntry = async (
    plan: Plans,
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    this.assertSupportedPlan(plan);

    const dbRow = await db.query.planCatalog.findFirst({
      where: eq(planCatalog.plan, plan as string),
    });

    if (!dbRow) {
      throw new Error('SUBSCRIPTION_PLAN_NOT_FOUND');
    }

    if (!dbRow.isActive) {
      throw new Error('SUBSCRIPTION_PLAN_INACTIVE');
    }

    return dbRow;
  };

  private buildSubscriptionPreviewSnapshot = async (
    plan: Plans,
    cycle: SubscriptionCycleType,
    startedAt: Date,
    db: LobeChatDatabase | Transaction = this.db,
  ) => {
    const dbRow = await this.getRequiredPlanCatalogEntry(plan, db);
    const entitlementSnapshot = buildPlanEntitlementSnapshot(dbRow);
    const preset = {
      currency: dbRow.currency,
      entitlementSnapshot,
      lifetimePrice: getPlanMetadataNumber(dbRow.metadata, 'lifetimePrice'),
      monthlyCredits: Number(dbRow.monthlyCredits),
      monthlyPrice: Number(dbRow.monthlyPrice),
      oneTimePrice: getPlanMetadataNumber(dbRow.metadata, 'oneTimePrice'),
      yearlyPrice: Number(dbRow.yearlyPrice),
    };

    switch (cycle) {
      case 'yearly': {
        const expiresAt = addCalendarYears(startedAt, 1);
        return {
          currency: preset.currency,
          entitlementSnapshot: preset.entitlementSnapshot,
          endsAt: expiresAt,
          monthlyCredits: preset.monthlyCredits,
          monthlyPrice: Number(preset.yearlyPrice.toFixed(2)),
          renewsAt: expiresAt,
        };
      }
      case 'one_time': {
        const cyclePrice =
          preset.oneTimePrice > 0
            ? preset.oneTimePrice
            : Number((preset.monthlyPrice * 12).toFixed(2));

        return {
          currency: preset.currency,
          entitlementSnapshot: preset.entitlementSnapshot,
          endsAt: addCalendarYears(startedAt, 1),
          monthlyCredits: preset.monthlyCredits,
          monthlyPrice: cyclePrice,
          renewsAt: null,
        };
      }
      case 'lifetime': {
        const cyclePrice =
          preset.lifetimePrice > 0
            ? preset.lifetimePrice
            : Number((preset.monthlyPrice * 24).toFixed(2));

        return {
          currency: preset.currency,
          entitlementSnapshot: preset.entitlementSnapshot,
          endsAt: null,
          monthlyCredits: preset.monthlyCredits,
          monthlyPrice: cyclePrice,
          renewsAt: null,
        };
      }
      default: {
        const expiresAt = addCalendarMonths(startedAt, 1);
        return {
          currency: preset.currency,
          entitlementSnapshot: preset.entitlementSnapshot,
          endsAt: expiresAt,
          monthlyCredits: preset.monthlyCredits,
          monthlyPrice: preset.monthlyPrice,
          renewsAt: expiresAt,
        };
      }
    }
  };

  createSubscriptionChangeRequest = async (
    input: CreateSubscriptionChangeRequestParams,
    options?: { tx?: Transaction },
  ): Promise<SubscriptionChangeRequestItem> => {
    await this.getRequiredPlanCatalogEntry(input.targetPlan, options?.tx ?? this.db);

    const create = async (tx: Transaction) => {
      await this.lockCommercialUserForUpdate(tx);
      const summary = await this.getSubscriptionSummary(tx);
      const existingPending = await this.getPendingSubscriptionChangeRequest(tx);

      if (summary.plan === input.targetPlan && summary.cycle === input.cycle) {
        throw new Error('SUBSCRIPTION_PLAN_UNCHANGED');
      }

      if (
        existingPending &&
        existingPending.toPlan === input.targetPlan &&
        existingPending.cycle === input.cycle
      ) {
        return existingPending;
      }

      if (existingPending) {
        await tx
          .update(subscriptionChangeRequests)
          .set({ status: 'canceled', updatedAt: new Date() })
          .where(eq(subscriptionChangeRequests.id, existingPending.id));
      }

      const [request] = await tx
        .insert(subscriptionChangeRequests)
        .values({
          cycle: input.cycle,
          fromPlan: summary.plan,
          reason: this.resolveSubscriptionChangeReason(summary.plan, input.targetPlan),
          status: 'pending',
          toPlan: input.targetPlan,
          userId: this.userId,
        })
        .returning();

      return request;
    };

    return options?.tx ? create(options.tx) : this.db.transaction(create);
  };

  cancelSubscriptionChangeRequest = async (): Promise<SubscriptionChangeRequestItem | null> => {
    const existingPending = await this.getPendingSubscriptionChangeRequest();

    if (!existingPending) return null;

    const [request] = await this.db
      .update(subscriptionChangeRequests)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(subscriptionChangeRequests.id, existingPending.id))
      .returning();

    return request || null;
  };

  activateSubscriptionChangeRequest = async (
    requestId: string,
    options?: {
      /**
       * Override the auto-computed end/renew date for this activation. Used by
       * redemption codes that grant a custom-length subscription (e.g. a 3-month
       * gift code on a monthly plan).
       *
       * For every finite cycle the value replaces the contractual `endsAt`.
       * Monthly/yearly activations also mirror it to `renewsAt` for display.
       */
      endsAtOverride?: Date | null;
      tx?: Transaction;
    },
  ): Promise<SubscriptionChangeRequestItem> => {
    const activate = async (tx: Transaction) => {
      await this.lockCommercialUserForUpdate(tx);
      await this.syncExpiredPlanSnapshots(tx);

      const request = await tx.query.subscriptionChangeRequests.findFirst({
        where: and(
          eq(subscriptionChangeRequests.id, requestId),
          eq(subscriptionChangeRequests.userId, this.userId),
        ),
      });

      if (!request) {
        throw new Error('SUBSCRIPTION_CHANGE_REQUEST_NOT_FOUND');
      }

      if (request.status !== 'pending') {
        throw new Error('SUBSCRIPTION_CHANGE_REQUEST_NOT_ACTIVATABLE');
      }

      const activatedAt = new Date();
      const currentSnapshot = await tx.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
        ),
      });

      if (currentSnapshot) {
        await tx
          .update(userPlanSnapshots)
          .set({
            endsAt: activatedAt,
            renewsAt: activatedAt,
            status: 'canceled',
            updatedAt: activatedAt,
          })
          .where(eq(userPlanSnapshots.id, currentSnapshot.id));
      }

      const previewSnapshot = await this.buildSubscriptionPreviewSnapshot(
        request.toPlan,
        request.cycle,
        activatedAt,
        tx,
      );

      // Apply optional duration override (used by redemption codes).
      const finalEndsAt =
        options?.endsAtOverride !== undefined && options.endsAtOverride !== null
          ? request.cycle === 'lifetime'
            ? previewSnapshot.endsAt
            : options.endsAtOverride
          : previewSnapshot.endsAt;
      const finalRenewsAt =
        options?.endsAtOverride !== undefined && options.endsAtOverride !== null
          ? request.cycle === 'monthly' || request.cycle === 'yearly'
            ? options.endsAtOverride
            : previewSnapshot.renewsAt
          : previewSnapshot.renewsAt;

      const [createdSnapshot] = await tx
        .insert(userPlanSnapshots)
        .values({
          currency: previewSnapshot.currency,
          cycle: request.cycle,
          endsAt: finalEndsAt,
          externalSubscriptionId: `preview-${request.id}`,
          metadata: {
            activatedFromChangeRequestId: request.id,
            entitlementSnapshot: previewSnapshot.entitlementSnapshot,
            ...(options?.endsAtOverride
              ? { endsAtOverride: options.endsAtOverride.toISOString() }
              : {}),
            previewMode: true,
          },
          monthlyCredits: previewSnapshot.monthlyCredits,
          monthlyPrice: previewSnapshot.monthlyPrice,
          plan: request.toPlan,
          provider: 'manual_preview',
          renewsAt: finalRenewsAt,
          startedAt: activatedAt,
          status: 'active',
          userId: this.userId,
        })
        .returning();

      await this.syncSubscriptionCreditsForSnapshot({
        snapshot: createdSnapshot,
        tx,
      });

      const [updatedRequest] = await tx
        .update(subscriptionChangeRequests)
        .set({ status: 'completed', updatedAt: activatedAt })
        .where(
          and(
            eq(subscriptionChangeRequests.id, request.id),
            eq(subscriptionChangeRequests.userId, this.userId),
            eq(subscriptionChangeRequests.status, 'pending'),
          ),
        )
        .returning();

      if (!updatedRequest) {
        throw new Error('SUBSCRIPTION_CHANGE_REQUEST_NOT_ACTIVATABLE');
      }

      return updatedRequest;
    };

    return options?.tx ? activate(options.tx) : this.db.transaction(activate);
  };

  private grantPlanWithSnapshot = async ({
    cycle,
    durationMonths,
    externalSubscriptionId,
    metadata,
    provider,
    targetPlan,
    tx,
  }: {
    cycle: SubscriptionCycleType;
    durationMonths?: number | null;
    externalSubscriptionId: string;
    metadata: (request: SubscriptionChangeRequestItem) => Record<string, unknown>;
    provider: string;
    targetPlan: Plans;
    tx: Transaction;
  }): Promise<SubscriptionChangeRequestItem> => {
    this.assertSupportedPlan(targetPlan);
    await this.lockCommercialUserForUpdate(tx);
    await this.syncExpiredPlanSnapshots(tx);

    const activatedAt = new Date();
    const currentSnapshot = await tx.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(eq(userPlanSnapshots.userId, this.userId), eq(userPlanSnapshots.status, 'active')),
    });
    const fromPlan = currentSnapshot?.plan ?? Plans.Free;

    await tx
      .update(subscriptionChangeRequests)
      .set({ status: 'canceled', updatedAt: activatedAt })
      .where(
        and(
          eq(subscriptionChangeRequests.userId, this.userId),
          eq(subscriptionChangeRequests.status, 'pending'),
        ),
      );

    const [request] = await tx
      .insert(subscriptionChangeRequests)
      .values({
        cycle,
        fromPlan,
        reason: this.resolveSubscriptionChangeReason(fromPlan, targetPlan),
        status: 'pending',
        toPlan: targetPlan,
        userId: this.userId,
      })
      .returning();

    if (!request) {
      throw new Error('SUBSCRIPTION_CHANGE_REQUEST_CREATE_FAILED');
    }

    if (currentSnapshot) {
      await tx
        .update(userPlanSnapshots)
        .set({
          endsAt: activatedAt,
          renewsAt: activatedAt,
          status: 'canceled',
          updatedAt: activatedAt,
        })
        .where(eq(userPlanSnapshots.id, currentSnapshot.id));
    }

    const previewSnapshot = await this.buildSubscriptionPreviewSnapshot(
      targetPlan,
      cycle,
      activatedAt,
      tx,
    );

    const extensionBase =
      currentSnapshot &&
      currentSnapshot.plan === targetPlan &&
      currentSnapshot.cycle === cycle &&
      (currentSnapshot.endsAt || currentSnapshot.renewsAt)
        ? new Date(
            Math.max(
              activatedAt.getTime(),
              (currentSnapshot.endsAt ?? currentSnapshot.renewsAt)!.getTime(),
            ),
          )
        : activatedAt;

    const { endsAt, renewsAt } = this.resolveRedeemedPlanExpiry({
      baseDate: extensionBase,
      cycle,
      durationMonths,
    });

    const [createdSnapshot] = await tx
      .insert(userPlanSnapshots)
      .values({
        currency: previewSnapshot.currency,
        cycle,
        endsAt,
        externalSubscriptionId,
        metadata: {
          ...metadata(request),
          entitlementSnapshot: previewSnapshot.entitlementSnapshot,
        },
        monthlyCredits: previewSnapshot.monthlyCredits,
        monthlyPrice: previewSnapshot.monthlyPrice,
        plan: targetPlan,
        provider,
        renewsAt,
        startedAt: activatedAt,
        status: 'active',
        userId: this.userId,
      })
      .returning();

    if (!createdSnapshot) {
      throw new Error('SUBSCRIPTION_SNAPSHOT_CREATE_FAILED');
    }

    await this.syncSubscriptionCreditsForSnapshot({
      snapshot: createdSnapshot,
      tx,
    });

    const [updatedRequest] = await tx
      .update(subscriptionChangeRequests)
      .set({ status: 'completed', updatedAt: activatedAt })
      .where(
        and(
          eq(subscriptionChangeRequests.id, request.id),
          eq(subscriptionChangeRequests.userId, this.userId),
          eq(subscriptionChangeRequests.status, 'pending'),
        ),
      )
      .returning();

    if (!updatedRequest) {
      throw new Error('SUBSCRIPTION_CHANGE_REQUEST_NOT_ACTIVATABLE');
    }

    return updatedRequest;
  };

  grantPlanFromRedemptionCode = async ({
    code,
    cycle,
    durationMonths,
    redemptionCodeId,
    targetPlan,
    tx,
  }: {
    code: string;
    cycle: SubscriptionCycleType;
    durationMonths?: number | null;
    redemptionCodeId: string;
    targetPlan: Plans;
    tx: Transaction;
  }): Promise<SubscriptionChangeRequestItem> => {
    return this.grantPlanWithSnapshot({
      cycle,
      durationMonths,
      externalSubscriptionId: `redemption-${redemptionCodeId}`,
      metadata: (request) => ({
        activatedFromChangeRequestId: request.id,
        durationMonths: durationMonths ?? this.getDefaultPlanDurationMonths(cycle),
        redemptionCode: code,
        redemptionCodeId,
      }),
      provider: 'redemption_code',
      targetPlan,
      tx,
    });
  };

  grantPlanManually = async ({
    assignedByUserId,
    cycle,
    durationMonths,
    manualGrantId,
    reason,
    targetPlan,
    tx,
  }: {
    assignedByUserId: string;
    cycle: SubscriptionCycleType;
    durationMonths?: number | null;
    manualGrantId: string;
    reason: string;
    targetPlan: Plans;
    tx: Transaction;
  }): Promise<SubscriptionChangeRequestItem> => {
    return this.grantPlanWithSnapshot({
      cycle,
      durationMonths,
      externalSubscriptionId: manualGrantId,
      metadata: (request) => ({
        activatedFromChangeRequestId: request.id,
        adminReason: reason,
        assignedByUserId,
        durationMonths: durationMonths ?? this.getDefaultPlanDurationMonths(cycle),
        manualGrantId,
        source: 'admin_manual',
      }),
      provider: 'admin_manual',
      targetPlan,
      tx,
    });
  };

  listSubscriptionChangeRequests = async (
    params: QueryCommercialListParams = {},
  ): Promise<SubscriptionChangeRequestItem[]> => {
    const { limit = 20 } = params;

    return this.db
      .select({
        createdAt: subscriptionChangeRequests.createdAt,
        cycle: subscriptionChangeRequests.cycle,
        fromPlan: subscriptionChangeRequests.fromPlan,
        id: subscriptionChangeRequests.id,
        reason: subscriptionChangeRequests.reason,
        status: subscriptionChangeRequests.status,
        toPlan: subscriptionChangeRequests.toPlan,
        updatedAt: subscriptionChangeRequests.updatedAt,
      })
      .from(subscriptionChangeRequests)
      .where(eq(subscriptionChangeRequests.userId, this.userId))
      .orderBy(desc(subscriptionChangeRequests.createdAt), desc(subscriptionChangeRequests.id))
      .limit(limit);
  };

  createSubscriptionPaymentOrder = async (input: {
    cycle: SubscriptionCycleType;
    idempotencyKey: string;
    method: PaymentMethodId;
    plan: Plans;
    provider: PaymentProvider;
  }) => {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error('SUBSCRIPTION_PAYMENT_IDEMPOTENCY_KEY_REQUIRED');

    const assertMatchingOrder = (order: typeof subscriptionPaymentOrders.$inferSelect) => {
      if (
        order.plan !== input.plan ||
        order.cycle !== input.cycle ||
        order.provider !== input.provider ||
        order.method !== input.method
      ) {
        throw new Error('SUBSCRIPTION_PAYMENT_IDEMPOTENCY_CONFLICT');
      }
      return order;
    };
    const existing = await this.db.query.subscriptionPaymentOrders.findFirst({
      where: and(
        eq(subscriptionPaymentOrders.userId, this.userId),
        eq(subscriptionPaymentOrders.idempotencyKey, idempotencyKey),
      ),
    });
    if (existing) return { created: false, order: assertMatchingOrder(existing) };

    if (input.plan === Plans.Free) throw new Error('SUBSCRIPTION_PLAN_NOT_PURCHASABLE');
    return this.db.transaction(async (tx) => {
      await this.lockCommercialUserForUpdate(tx);

      const concurrentExisting = await tx.query.subscriptionPaymentOrders.findFirst({
        where: and(
          eq(subscriptionPaymentOrders.userId, this.userId),
          eq(subscriptionPaymentOrders.idempotencyKey, idempotencyKey),
        ),
      });
      if (concurrentExisting) {
        return { created: false, order: assertMatchingOrder(concurrentExisting) };
      }

      const quotedAt = new Date();
      await this.syncExpiredPlanSnapshots(tx);
      await tx
        .update(subscriptionPaymentOrders)
        .set({ status: 'expired', updatedAt: quotedAt })
        .where(
          and(
            eq(subscriptionPaymentOrders.userId, this.userId),
            eq(subscriptionPaymentOrders.status, 'pending'),
            lt(subscriptionPaymentOrders.expiresAt, quotedAt),
          ),
        );

      const activeSnapshot = await tx.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
        ),
      });
      if (
        input.cycle === 'lifetime' &&
        activeSnapshot?.plan === input.plan &&
        activeSnapshot.cycle === 'lifetime'
      ) {
        throw new Error('SUBSCRIPTION_LIFETIME_PLAN_ALREADY_ACTIVE');
      }
      if (activeSnapshot?.plan === input.plan && activeSnapshot.cycle === input.cycle) {
        const latestPaymentOrderId = getSnapshotMetadata(
          activeSnapshot.metadata,
        )?.lastPaymentOrderId;
        if (typeof latestPaymentOrderId === 'string') {
          const latestPaymentOrder = await tx.query.subscriptionPaymentOrders.findFirst({
            where: and(
              eq(subscriptionPaymentOrders.id, latestPaymentOrderId),
              eq(subscriptionPaymentOrders.userId, this.userId),
            ),
          });
          if (
            latestPaymentOrder?.refundStatus === 'pending' ||
            latestPaymentOrder?.refundStatus === 'succeeded'
          ) {
            throw new Error('SUBSCRIPTION_RENEWAL_BLOCKED_BY_REFUND');
          }
        }
      }
      if (input.cycle === 'lifetime') {
        const pendingLifetimeOrder = await tx.query.subscriptionPaymentOrders.findFirst({
          columns: { id: true },
          where: and(
            eq(subscriptionPaymentOrders.userId, this.userId),
            eq(subscriptionPaymentOrders.plan, input.plan),
            eq(subscriptionPaymentOrders.cycle, 'lifetime'),
            eq(subscriptionPaymentOrders.status, 'pending'),
          ),
        });
        if (pendingLifetimeOrder) {
          throw new Error('SUBSCRIPTION_LIFETIME_PAYMENT_PENDING');
        }
      }

      const catalog = await tx.query.planCatalog.findFirst({
        where: and(eq(planCatalog.plan, input.plan), eq(planCatalog.isActive, true)),
      });
      if (!catalog) throw new Error('SUBSCRIPTION_PLAN_NOT_FOUND');
      const amount =
        input.cycle === 'monthly'
          ? Number(catalog.monthlyPrice)
          : input.cycle === 'yearly'
            ? Number(catalog.yearlyPrice)
            : getPlanMetadataNumber(
                catalog.metadata,
                input.cycle === 'lifetime' ? 'lifetimePrice' : 'oneTimePrice',
              );
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('SUBSCRIPTION_CYCLE_NOT_PURCHASABLE');
      }
      if (catalog.currency !== 'CNY') throw new Error('SUBSCRIPTION_CURRENCY_UNSUPPORTED');

      const entitlementSnapshot = buildPlanEntitlementSnapshot(catalog);
      const snapshot: SubscriptionPaymentOrderSnapshot =
        subscriptionPaymentOrderSnapshotSchema.parse({
          amount: amount.toFixed(6),
          currency: catalog.currency,
          cycle: input.cycle,
          displayName: catalog.displayName,
          ...entitlementSnapshot,
          monthlyCredits: Number(catalog.monthlyCredits),
          monthlyPrice: Number(catalog.monthlyPrice),
          plan: input.plan,
          quotedAt: quotedAt.toISOString(),
        });
      const [order] = await tx
        .insert(subscriptionPaymentOrders)
        .values({
          amount,
          currency: catalog.currency,
          cycle: input.cycle,
          expiresAt: new Date(quotedAt.getTime() + 30 * 60 * 1000),
          idempotencyKey,
          method: input.method,
          plan: input.plan,
          provider: input.provider,
          snapshot,
          userId: this.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (order) return { created: true, order: assertMatchingOrder(order) };

      const concurrent = await tx.query.subscriptionPaymentOrders.findFirst({
        where: and(
          eq(subscriptionPaymentOrders.userId, this.userId),
          eq(subscriptionPaymentOrders.idempotencyKey, idempotencyKey),
        ),
      });
      if (!concurrent) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_CREATE_FAILED');
      return { created: false, order: assertMatchingOrder(concurrent) };
    });
  };

  bindSubscriptionPayment = async (input: { externalOrderId: string; orderId: string }) => {
    const [updated] = await this.db
      .update(subscriptionPaymentOrders)
      .set({ externalOrderId: input.externalOrderId, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, input.orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          eq(subscriptionPaymentOrders.status, 'pending'),
          sql`${subscriptionPaymentOrders.externalOrderId} IS NULL`,
        ),
      )
      .returning();
    if (updated) return { claimed: true, order: updated };
    const order = await this.db.query.subscriptionPaymentOrders.findFirst({
      where: and(
        eq(subscriptionPaymentOrders.id, input.orderId),
        eq(subscriptionPaymentOrders.userId, this.userId),
      ),
    });
    if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    if (order.externalOrderId !== input.externalOrderId) {
      throw new Error('SUBSCRIPTION_PAYMENT_BIND_CONFLICT');
    }
    return { claimed: false, order };
  };

  storeSubscriptionPaymentCheckout = async (input: {
    checkout: PaymentCheckoutAction;
    orderId: string;
  }) => {
    const [updated] = await this.db
      .update(subscriptionPaymentOrders)
      .set({ checkout: input.checkout, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, input.orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          sql`${subscriptionPaymentOrders.checkout} IS NULL`,
        ),
      )
      .returning();
    if (updated) return updated;
    const order = await this.db.query.subscriptionPaymentOrders.findFirst({
      where: and(
        eq(subscriptionPaymentOrders.id, input.orderId),
        eq(subscriptionPaymentOrders.userId, this.userId),
      ),
    });
    if (!order?.checkout) throw new Error('SUBSCRIPTION_PAYMENT_CHECKOUT_STORE_FAILED');
    return order;
  };

  getSubscriptionPaymentOrder = (orderId: string) =>
    this.db.query.subscriptionPaymentOrders.findFirst({
      where: and(
        eq(subscriptionPaymentOrders.id, orderId),
        eq(subscriptionPaymentOrders.userId, this.userId),
      ),
    });

  getSubscriptionPaymentOrderByIdempotencyKey = (idempotencyKey: string) =>
    this.db.query.subscriptionPaymentOrders.findFirst({
      where: and(
        eq(subscriptionPaymentOrders.userId, this.userId),
        eq(subscriptionPaymentOrders.idempotencyKey, idempotencyKey.trim()),
      ),
    });

  claimSubscriptionPaymentRefund = async (input: { orderId: string; refundReference: string }) => {
    const refundReference = input.refundReference.trim();
    if (!refundReference) throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_REQUIRED');

    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(subscriptionPaymentOrders)
        .where(
          and(
            eq(subscriptionPaymentOrders.id, input.orderId),
            eq(subscriptionPaymentOrders.userId, this.userId),
          ),
        )
        .for('update');
      if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
      if (order.status === 'paid') {
        await this.lockCommercialUserForUpdate(tx);
        await this.assertSubscriptionPaymentOrderIsLatest(order, tx);
      }
      if (
        order.status !== 'paid' ||
        !(
          ((order.refundStatus === null || order.refundStatus === 'failed') &&
            (order.refundReference === null || order.refundReference === refundReference)) ||
          (order.refundStatus === 'pending' && order.refundReference === null)
        )
      ) {
        return { claimed: false as const, order };
      }

      const [claimed] = await tx
        .update(subscriptionPaymentOrders)
        .set({ refundReference, refundStatus: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(subscriptionPaymentOrders.id, order.id),
            eq(subscriptionPaymentOrders.userId, this.userId),
            eq(subscriptionPaymentOrders.status, 'paid'),
            or(
              and(
                or(
                  isNull(subscriptionPaymentOrders.refundStatus),
                  eq(subscriptionPaymentOrders.refundStatus, 'failed'),
                ),
                or(
                  isNull(subscriptionPaymentOrders.refundReference),
                  eq(subscriptionPaymentOrders.refundReference, refundReference),
                ),
              ),
              and(
                eq(subscriptionPaymentOrders.refundStatus, 'pending'),
                isNull(subscriptionPaymentOrders.refundReference),
              ),
            ),
          ),
        )
        .returning();
      if (!claimed) throw new Error('SUBSCRIPTION_PAYMENT_REFUND_CLAIM_FAILED');
      return { claimed: true as const, order: claimed };
    });
  };

  claimUncreditedSubscriptionPaymentRefund = async (input: {
    orderId: string;
    refundReference: string;
  }) => {
    const refundReference = input.refundReference.trim();
    if (!refundReference) throw new Error('SUBSCRIPTION_PAYMENT_REFUND_REFERENCE_REQUIRED');

    const [claimed] = await this.db
      .update(subscriptionPaymentOrders)
      .set({ refundReference, refundStatus: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, input.orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          inArray(subscriptionPaymentOrders.status, ['canceled', 'expired', 'failed', 'pending']),
          or(
            and(
              or(
                isNull(subscriptionPaymentOrders.refundStatus),
                eq(subscriptionPaymentOrders.refundStatus, 'failed'),
              ),
              or(
                isNull(subscriptionPaymentOrders.refundReference),
                eq(subscriptionPaymentOrders.refundReference, refundReference),
              ),
            ),
            and(
              eq(subscriptionPaymentOrders.refundStatus, 'pending'),
              isNull(subscriptionPaymentOrders.refundReference),
            ),
          ),
        ),
      )
      .returning();
    if (claimed) return { claimed: true as const, order: claimed };

    const order = await this.getSubscriptionPaymentOrder(input.orderId);
    if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    return { claimed: false as const, order };
  };

  updateSubscriptionPaymentRefundStatus = async (input: {
    expectedRefundReference: null | string;
    expectedStatus: 'failed' | 'pending' | 'succeeded';
    orderId: string;
    refundReference: string;
    status: 'failed' | 'pending' | 'succeeded';
  }) => {
    const [updated] = await this.db
      .update(subscriptionPaymentOrders)
      .set({
        refundReference: input.refundReference,
        refundStatus: input.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, input.orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          input.expectedRefundReference === null
            ? isNull(subscriptionPaymentOrders.refundReference)
            : eq(subscriptionPaymentOrders.refundReference, input.expectedRefundReference),
          eq(subscriptionPaymentOrders.refundStatus, input.expectedStatus),
          inArray(subscriptionPaymentOrders.status, [
            'canceled',
            'expired',
            'failed',
            'paid',
            'pending',
          ]),
        ),
      )
      .returning();
    if (updated) return updated;

    const order = await this.getSubscriptionPaymentOrder(input.orderId);
    if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
    return order;
  };

  markUncreditedSubscriptionPaymentRefunded = async (input: {
    orderId: string;
    refundReference: string;
  }) => {
    const refundedAt = new Date();
    const [updated] = await this.db
      .update(subscriptionPaymentOrders)
      .set({
        refundedAt,
        refundReference: input.refundReference,
        refundStatus: 'succeeded',
        status: 'refunded',
        updatedAt: refundedAt,
      })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, input.orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          inArray(subscriptionPaymentOrders.status, ['canceled', 'expired', 'failed', 'pending']),
        ),
      )
      .returning();
    return updated ?? null;
  };

  expireSubscriptionPaymentOrder = async (orderId: string) => {
    const now = new Date();
    const [expired] = await this.db
      .update(subscriptionPaymentOrders)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(subscriptionPaymentOrders.id, orderId),
          eq(subscriptionPaymentOrders.userId, this.userId),
          eq(subscriptionPaymentOrders.status, 'pending'),
          lt(subscriptionPaymentOrders.expiresAt, now),
        ),
      )
      .returning();
    return expired ?? null;
  };

  settleSubscriptionPaymentOrder = async (input: {
    amount: string;
    currency: string;
    externalOrderId: string;
    method: PaymentMethodId;
    orderId: string;
    paymentReference?: string;
    provider: PaymentProvider;
  }) => {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(subscriptionPaymentOrders)
        .where(
          and(
            eq(subscriptionPaymentOrders.id, input.orderId),
            eq(subscriptionPaymentOrders.userId, this.userId),
          ),
        )
        .for('update');
      if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
      if (
        order.provider !== input.provider ||
        order.method !== input.method ||
        order.externalOrderId !== input.externalOrderId ||
        order.currency !== input.currency ||
        Number(order.amount).toFixed(6) !== Number(input.amount).toFixed(6) ||
        (order.paymentReference &&
          input.paymentReference &&
          order.paymentReference !== input.paymentReference)
      ) {
        throw new Error('SUBSCRIPTION_PAYMENT_VERIFICATION_FAILED');
      }
      if (order.status === 'paid') return order;
      if (!['expired', 'failed', 'pending'].includes(order.status)) {
        throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_SETTLEABLE');
      }

      const snapshot = subscriptionPaymentOrderSnapshotSchema.parse(order.snapshot);
      await this.lockCommercialUserForUpdate(tx);
      await this.syncExpiredPlanSnapshots(tx);
      const activatedAt = new Date();
      const currentSnapshot = await tx.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
        ),
      });
      if (
        snapshot.cycle === 'lifetime' &&
        currentSnapshot?.plan === snapshot.plan &&
        currentSnapshot.cycle === 'lifetime' &&
        getSnapshotMetadata(currentSnapshot.metadata)?.lastPaymentOrderId !== order.id
      ) {
        const [canceled] = await tx
          .update(subscriptionPaymentOrders)
          .set({
            paidAt: activatedAt,
            paymentReference: input.paymentReference ?? input.externalOrderId,
            status: 'canceled',
            updatedAt: activatedAt,
          })
          .where(
            and(
              eq(subscriptionPaymentOrders.id, order.id),
              inArray(subscriptionPaymentOrders.status, ['pending', 'failed', 'expired']),
            ),
          )
          .returning();
        if (!canceled) throw new Error('SUBSCRIPTION_DUPLICATE_LIFETIME_CANCEL_FAILED');
        return canceled;
      }
      const isRenewal =
        currentSnapshot?.plan === snapshot.plan && currentSnapshot.cycle === snapshot.cycle;
      if (isRenewal && currentSnapshot) {
        const latestPaymentOrderId = getSnapshotMetadata(
          currentSnapshot.metadata,
        )?.lastPaymentOrderId;
        if (typeof latestPaymentOrderId === 'string') {
          const latestPaymentOrder = await tx.query.subscriptionPaymentOrders.findFirst({
            columns: { refundStatus: true },
            where: and(
              eq(subscriptionPaymentOrders.id, latestPaymentOrderId),
              eq(subscriptionPaymentOrders.userId, this.userId),
            ),
          });
          if (
            latestPaymentOrder?.refundStatus === 'pending' ||
            latestPaymentOrder?.refundStatus === 'succeeded'
          ) {
            throw new Error('SUBSCRIPTION_RENEWAL_BLOCKED_BY_REFUND');
          }
        }
      }
      const previousSnapshot = currentSnapshot
        ? {
            currency: currentSnapshot.currency,
            endsAt: currentSnapshot.endsAt?.toISOString() ?? null,
            id: currentSnapshot.id,
            metadata: currentSnapshot.metadata,
            monthlyCredits: currentSnapshot.monthlyCredits,
            monthlyPrice: currentSnapshot.monthlyPrice,
            provider: currentSnapshot.provider,
            renewsAt: currentSnapshot.renewsAt?.toISOString() ?? null,
          }
        : null;
      let refundableCreditPeriodStartsAt = activatedAt;

      await tx
        .update(subscriptionChangeRequests)
        .set({ status: 'canceled', updatedAt: activatedAt })
        .where(
          and(
            eq(subscriptionChangeRequests.userId, this.userId),
            eq(subscriptionChangeRequests.status, 'pending'),
          ),
        );
      await tx.insert(subscriptionChangeRequests).values({
        cycle: snapshot.cycle,
        fromPlan: currentSnapshot?.plan ?? Plans.Free,
        reason: this.resolveSubscriptionChangeReason(
          currentSnapshot?.plan ?? Plans.Free,
          snapshot.plan,
        ),
        status: 'completed',
        toPlan: snapshot.plan,
        userId: this.userId,
      });

      let activatedSnapshot: typeof userPlanSnapshots.$inferSelect;
      if (isRenewal && currentSnapshot) {
        const extensionBase = new Date(
          Math.max(
            activatedAt.getTime(),
            (currentSnapshot.endsAt ?? currentSnapshot.renewsAt ?? activatedAt).getTime(),
          ),
        );
        refundableCreditPeriodStartsAt = extensionBase;
        const { endsAt, renewsAt } = this.resolveRedeemedPlanExpiry({
          baseDate: extensionBase,
          cycle: snapshot.cycle,
        });
        const [renewed] = await tx
          .update(userPlanSnapshots)
          .set({
            currency: snapshot.currency,
            endsAt,
            metadata: {
              ...currentSnapshot.metadata,
              entitlementSnapshot: toEntitlementSnapshot(snapshot),
              lastPaymentOrderId: order.id,
              pricingSnapshot: snapshot,
            },
            monthlyCredits: snapshot.monthlyCredits,
            monthlyPrice: snapshot.monthlyPrice,
            provider: input.provider,
            renewsAt,
            updatedAt: activatedAt,
          })
          .where(eq(userPlanSnapshots.id, currentSnapshot.id))
          .returning();
        if (!renewed) throw new Error('SUBSCRIPTION_RENEWAL_FAILED');
        activatedSnapshot = renewed;
      } else {
        if (currentSnapshot) {
          await tx
            .update(userPlanSnapshots)
            .set({
              endsAt: activatedAt,
              renewsAt: activatedAt,
              status: 'canceled',
              updatedAt: activatedAt,
            })
            .where(eq(userPlanSnapshots.id, currentSnapshot.id));
        }
        const { endsAt, renewsAt } = this.resolveRedeemedPlanExpiry({
          baseDate: activatedAt,
          cycle: snapshot.cycle,
        });
        const [created] = await tx
          .insert(userPlanSnapshots)
          .values({
            currency: snapshot.currency,
            cycle: snapshot.cycle,
            endsAt,
            externalSubscriptionId: `payment:${order.id}`,
            metadata: {
              entitlementSnapshot: toEntitlementSnapshot(snapshot),
              lastPaymentOrderId: order.id,
              paymentOrderId: order.id,
              pricingSnapshot: snapshot,
            },
            monthlyCredits: snapshot.monthlyCredits,
            monthlyPrice: snapshot.monthlyPrice,
            plan: snapshot.plan,
            provider: input.provider,
            renewsAt,
            startedAt: activatedAt,
            status: 'active',
            userId: this.userId,
          })
          .returning();
        if (!created) throw new Error('SUBSCRIPTION_SNAPSHOT_CREATE_FAILED');
        activatedSnapshot = created;
      }

      const { grantedLotReferenceIds } = await this.syncSubscriptionCreditsForSnapshot({
        snapshot: activatedSnapshot,
        tx,
      });
      const [settled] = await tx
        .update(subscriptionPaymentOrders)
        .set({
          activatedSnapshotId: activatedSnapshot.id,
          activation: {
            grantedLotReferenceIds,
            kind: isRenewal ? 'renewal' : 'activation',
            previousSnapshot,
            refundableCreditPeriodStartsAt: refundableCreditPeriodStartsAt.toISOString(),
          },
          paidAt: activatedAt,
          paymentReference: input.paymentReference ?? input.externalOrderId,
          status: 'paid',
          updatedAt: activatedAt,
        })
        .where(
          and(
            eq(subscriptionPaymentOrders.id, order.id),
            inArray(subscriptionPaymentOrders.status, ['pending', 'failed', 'expired']),
          ),
        )
        .returning();
      if (!settled) throw new Error('SUBSCRIPTION_PAYMENT_SETTLEMENT_FAILED');
      return settled;
    });
  };

  refundSubscriptionPaymentOrder = async (input: {
    amount: string;
    method: PaymentMethodId;
    orderId: string;
    provider: PaymentProvider;
    refundReference: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(subscriptionPaymentOrders)
        .where(
          and(
            eq(subscriptionPaymentOrders.id, input.orderId),
            eq(subscriptionPaymentOrders.userId, this.userId),
          ),
        )
        .for('update');
      if (!order) throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND');
      if (
        order.provider !== input.provider ||
        order.method !== input.method ||
        Number(order.amount).toFixed(6) !== Number(input.amount).toFixed(6)
      ) {
        throw new Error('SUBSCRIPTION_PAYMENT_VERIFICATION_FAILED');
      }
      if (order.status === 'refunded') return { debtAmount: 0, order };
      if (order.status !== 'paid') throw new Error('SUBSCRIPTION_PAYMENT_ORDER_NOT_REFUNDABLE');

      await this.lockCommercialUserForUpdate(tx);
      await this.assertSubscriptionPaymentOrderIsLatest(order, tx);
      const activation =
        order.activation && typeof order.activation === 'object' ? order.activation : {};
      const legacyLotReferences = Array.isArray(activation.grantedLotReferenceIds)
        ? activation.grantedLotReferenceIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const current = await tx.query.userPlanSnapshots.findFirst({
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
        ),
      });
      const refundableCreditPeriodStartsAt =
        typeof activation.refundableCreditPeriodStartsAt === 'string'
          ? new Date(activation.refundableCreditPeriodStartsAt)
          : null;
      const lotModel = new CreditLotModel(this.db, this.userId);
      const snapshotLotReferences =
        order.activatedSnapshotId &&
        refundableCreditPeriodStartsAt &&
        !Number.isNaN(refundableCreditPeriodStartsAt.getTime())
          ? await lotModel.listRefundableSubscriptionLotReferences(
              {
                periodStartsAt: refundableCreditPeriodStartsAt,
                snapshotId: order.activatedSnapshotId,
              },
              tx,
            )
          : [];
      const lotReferences = [...new Set([...snapshotLotReferences, ...legacyLotReferences])];
      let debtAmount = 0;
      for (const referenceId of lotReferences) {
        const reversal = await lotModel.refundLot(
          {
            debtReason: 'refunded_subscription_credits_already_consumed',
            metadata: { orderId: order.id, refundReference: input.refundReference },
            referenceId,
            referenceType: 'subscription_snapshot_period',
            refundLedgerReferenceType: 'subscription_refund',
          },
          tx,
        );
        debtAmount += reversal.debtAmount;
      }

      const refundedAt = new Date();
      if (current?.id === order.activatedSnapshotId) {
        const previous =
          activation.previousSnapshot && typeof activation.previousSnapshot === 'object'
            ? (activation.previousSnapshot as Record<string, unknown>)
            : null;
        if (activation.kind === 'renewal' && previous?.id === current.id) {
          await tx
            .update(userPlanSnapshots)
            .set({
              currency:
                typeof previous.currency === 'string' ? previous.currency : current.currency,
              endsAt: typeof previous.endsAt === 'string' ? new Date(previous.endsAt) : null,
              metadata: getSnapshotMetadata(previous.metadata) ?? current.metadata,
              monthlyCredits:
                typeof previous.monthlyCredits === 'number'
                  ? previous.monthlyCredits
                  : current.monthlyCredits,
              monthlyPrice:
                typeof previous.monthlyPrice === 'number'
                  ? previous.monthlyPrice
                  : current.monthlyPrice,
              provider:
                typeof previous.provider === 'string' ? previous.provider : current.provider,
              renewsAt: typeof previous.renewsAt === 'string' ? new Date(previous.renewsAt) : null,
              updatedAt: refundedAt,
            })
            .where(eq(userPlanSnapshots.id, current.id));
        } else {
          await tx
            .update(userPlanSnapshots)
            .set({
              endsAt: refundedAt,
              renewsAt: refundedAt,
              status: 'canceled',
              updatedAt: refundedAt,
            })
            .where(eq(userPlanSnapshots.id, current.id));
          if (previous && typeof previous.id === 'string') {
            const previousEndsAt =
              typeof previous.endsAt === 'string' ? new Date(previous.endsAt) : null;
            if (!previousEndsAt || previousEndsAt > refundedAt) {
              await tx
                .update(userPlanSnapshots)
                .set({
                  endsAt: previousEndsAt,
                  renewsAt:
                    typeof previous.renewsAt === 'string' ? new Date(previous.renewsAt) : null,
                  status: 'active',
                  updatedAt: refundedAt,
                })
                .where(eq(userPlanSnapshots.id, previous.id));
            }
          }
        }
      }

      const effectiveSnapshot = await tx.query.userPlanSnapshots.findFirst({
        orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
        where: and(
          eq(userPlanSnapshots.userId, this.userId),
          eq(userPlanSnapshots.status, 'active'),
          or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, refundedAt)),
        ),
      });
      if (effectiveSnapshot) {
        await this.syncPlanResourceQuotasForSnapshot(effectiveSnapshot, tx);
      } else {
        const freeSnapshot = await this.ensureUnlimitedFreePlanSnapshot(tx, refundedAt);
        if (freeSnapshot) await this.syncPlanResourceQuotasForSnapshot(freeSnapshot, tx);
      }

      const [refunded] = await tx
        .update(subscriptionPaymentOrders)
        .set({
          refundedAt,
          refundReference: input.refundReference,
          refundStatus: 'succeeded',
          status: 'refunded',
          updatedAt: refundedAt,
        })
        .where(
          and(
            eq(subscriptionPaymentOrders.id, order.id),
            eq(subscriptionPaymentOrders.status, 'paid'),
          ),
        )
        .returning();
      if (!refunded) throw new Error('SUBSCRIPTION_PAYMENT_REFUND_FAILED');
      return { debtAmount, order: refunded };
    });
  };

  createTopUpOrder = (input: CreateTopUpOrderParams): Promise<TopUpOrderHistoryItem> =>
    this.topUp.createTopUpOrder(input);

  cancelTopUpOrder = (orderId: string): Promise<TopUpOrderHistoryItem> =>
    this.topUp.cancelTopUpOrder(orderId);

  settleTopUpOrder = (orderId: string): Promise<TopUpOrderHistoryItem> =>
    this.topUp.settleTopUpOrder(orderId);

  createOnlineTopUpOrder = (input: {
    idempotencyKey: string;
    method: PaymentMethodId;
    packageId: string;
    provider: PaymentProvider;
  }) => this.topUp.createOnlineTopUpOrder(input);

  bindOnlineTopUpPayment = (input: {
    externalOrderId: string;
    method: PaymentMethodId;
    orderId: string;
    provider: PaymentProvider;
  }) => this.topUp.bindOnlineTopUpPayment(input);

  storeOnlineTopUpCheckout = (input: { checkout: PaymentCheckoutAction; orderId: string }) =>
    this.topUp.storeOnlineTopUpCheckout(input);

  getTopUpOrder = (orderId: string) => this.topUp.getTopUpOrder(orderId);

  getOnlineTopUpOrderByIdempotencyKey = (idempotencyKey: string) =>
    this.topUp.getOnlineTopUpOrderByIdempotencyKey(idempotencyKey);

  settleOnlineTopUpOrder = (input: {
    amount: string;
    currency: string;
    externalOrderId: string;
    method: PaymentMethodId;
    orderId: string;
    paymentReference?: string;
    provider: PaymentProvider;
  }) => this.topUp.settleOnlineTopUpOrder(input);

  expireOnlineTopUpOrder = (orderId: string) => this.topUp.expireOnlineTopUpOrder(orderId);

  recordOnlineTopUpPaymentEvent = (event: ModuleAppNormalizedPaymentEvent) =>
    this.topUp.recordOnlineTopUpPaymentEvent(event);

  updateOnlineTopUpPaymentEvent = (input: {
    errorCode?: string | null;
    eventId: string;
    orderId?: string | null;
    provider: PaymentProvider;
    status: 'failed' | 'ignored' | 'processed' | 'received' | 'rejected';
  }) => this.topUp.updateOnlineTopUpPaymentEvent(input);

  refundOnlineTopUpOrder = (input: {
    amount: string;
    method: PaymentMethodId;
    orderId: string;
    provider: PaymentProvider;
    refundReference: string;
  }) => this.topUp.refundOnlineTopUpOrder(input);

  claimOnlineTopUpRefund = (input: { orderId: string; refundReference: string }) =>
    this.topUp.claimOnlineTopUpRefund(input);

  claimUncreditedOnlineTopUpRefund = (input: { orderId: string; refundReference: string }) =>
    this.topUp.claimUncreditedOnlineTopUpRefund(input);

  markUncreditedOnlineTopUpRefunded = (input: { orderId: string; refundReference: string }) =>
    this.topUp.markUncreditedOnlineTopUpRefunded(input);

  updateOnlineTopUpRefundStatus = (input: {
    expectedRefundReference: null | string;
    expectedStatus: 'failed' | 'pending' | 'succeeded';
    orderId: string;
    refundReference: string;
    status: 'failed' | 'pending' | 'succeeded';
  }) => this.topUp.updateOnlineTopUpRefundStatus(input);

  getReferralStatus = async () => {
    const relation = await this.db.query.referralRelations.findFirst({
      columns: { status: true },
      orderBy: [desc(referralRelations.createdAt)],
      where: eq(referralRelations.inviteeUserId, this.userId),
    });

    return relation?.status;
  };

  getReferralOverview = async (): Promise<ReferralOverview> => {
    const [aggregate, currentReferralStatus, referralProfile, rewardCreditsPerInvite] =
      await Promise.all([
        this.db
          .select({
            totalInvites: sql<number>`COUNT(*)::int`,
            totalRewarded: sql<number>`COUNT(*) FILTER (WHERE ${referralRelations.status} = 'rewarded')::int`,
            totalRewardedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${referralRelations.status} = 'rewarded' THEN ${referralRelations.rewardCredits} ELSE 0 END), 0)::float8`,
          })
          .from(referralRelations)
          .where(eq(referralRelations.inviterUserId, this.userId))
          .limit(1),
        this.getReferralStatus(),
        this.getReferralProfile(),
        this.resolveReferralRewardCredits(),
      ]);

    return {
      currentReferralStatus,
      referralCode: referralProfile.code,
      rewardCreditsPerInvite,
      totalInvites: aggregate[0]?.totalInvites ?? 0,
      totalRewarded: aggregate[0]?.totalRewarded ?? 0,
      totalRewardedAmount: aggregate[0]?.totalRewardedAmount ?? 0,
    };
  };

  activateReferralReward = async () => {
    const configuredRewardCredits = await this.resolveReferralRewardCredits();

    return this.db.transaction(async (tx) => {
      const relation = await tx.query.referralRelations.findFirst({
        where: eq(referralRelations.inviteeUserId, this.userId),
      });

      if (!relation) {
        throw new Error('REFERRAL_REWARD_NOT_FOUND');
      }

      if (relation.status !== 'registered' && relation.status !== 'pending_reward') {
        throw new Error('REFERRAL_REWARD_NOT_ACTIVATABLE');
      }

      const rewardedAt = new Date();
      const relationRewardCredits = Number(relation.rewardCredits);
      const rewardCredits =
        Number.isFinite(relationRewardCredits) && relationRewardCredits > 0
          ? relationRewardCredits
          : configuredRewardCredits;

      const [updatedRelation] = await tx
        .update(referralRelations)
        .set({
          rewardCredits,
          rewardedAt,
          status: 'rewarded',
          updatedAt: rewardedAt,
        })
        .where(
          and(
            eq(referralRelations.id, relation.id),
            eq(referralRelations.inviteeUserId, this.userId),
            or(
              eq(referralRelations.status, 'registered'),
              eq(referralRelations.status, 'pending_reward'),
            ),
          ),
        )
        .returning();

      if (!updatedRelation) {
        throw new Error('REFERRAL_REWARD_NOT_ACTIVATABLE');
      }

      const inviterLedgerEntryId = await this.grantCreditsToUser({
        amount: rewardCredits,
        description: `Referral reward for inviting ${this.userId.slice(0, 8).toUpperCase()}`,
        metadata: {
          previewMode: true,
          relationId: relation.id,
          role: 'inviter',
        },
        referenceId: relation.id,
        referenceType: 'referral_relation',
        title: 'Referral Reward',
        tx,
        type: 'referral_reward',
        userId: relation.inviterUserId,
      });

      const inviteeLedgerEntryId = await this.grantCreditsToUser({
        amount: rewardCredits,
        description: `Referral reward activated for code ${relation.code || 'REFERRAL'}`,
        metadata: {
          previewMode: true,
          relationId: relation.id,
          role: 'invitee',
        },
        referenceId: relation.id,
        referenceType: 'referral_relation',
        title: 'Referral Reward',
        tx,
        type: 'referral_reward',
        userId: this.userId,
      });

      await tx.insert(referralRewards).values([
        {
          amount: rewardCredits,
          ledgerEntryId: inviterLedgerEntryId,
          metadata: { previewMode: true },
          relationId: relation.id,
          rewardUserId: relation.inviterUserId,
          role: 'inviter',
        },
        {
          amount: rewardCredits,
          ledgerEntryId: inviteeLedgerEntryId,
          metadata: { previewMode: true },
          relationId: relation.id,
          rewardUserId: this.userId,
          role: 'invitee',
        },
      ]);

      return updatedRelation;
    });
  };

  listReferralHistory = async (
    params: QueryCommercialListParams = {},
  ): Promise<ReferralHistoryItem[]> => {
    const { limit = 20 } = params;

    return this.db
      .select({
        createdAt: referralRelations.createdAt,
        id: referralRelations.id,
        inviteeEmail:
          sql<string>`CASE WHEN ${users.email} IS NULL THEN NULL ELSE CONCAT(LEFT(${users.email}, 2), '***', SUBSTRING(${users.email} FROM POSITION('@' IN ${users.email}))) END`.as(
            'inviteeEmail',
          ),
        inviterRewardAmount: referralRelations.rewardCredits,
        rewardedAt: referralRelations.rewardedAt,
        status: referralRelations.status,
      })
      .from(referralRelations)
      .leftJoin(users, eq(users.id, referralRelations.inviteeUserId))
      .where(eq(referralRelations.inviterUserId, this.userId))
      .orderBy(desc(referralRelations.createdAt), desc(referralRelations.id))
      .limit(limit);
  };

  listBillingOrders = async (
    params: QueryCommercialListParams = {},
  ): Promise<BillingOrderHistoryItem[]> => {
    const { limit = 20 } = params;
    const [topUpOrderRows, subscriptionOrderRows] = await Promise.all([
      this.db
        .select({
          amount: topUpOrders.amount,
          createdAt: topUpOrders.createdAt,
          credits: topUpOrders.credits,
          currency: topUpOrders.currency,
          externalOrderId: topUpOrders.externalOrderId,
          id: topUpOrders.id,
          paidAt: topUpOrders.paidAt,
          provider: topUpOrders.provider,
          status: topUpOrders.status,
        })
        .from(topUpOrders)
        .where(
          and(
            eq(topUpOrders.userId, this.userId),
            or(
              inArray(topUpOrders.provider, ['alipay', 'wechat_pay', 'zpay']),
              inArray(topUpOrders.source, ['alipay', 'wechat_pay', 'zpay']),
            ),
          ),
        )
        .orderBy(desc(topUpOrders.createdAt), desc(topUpOrders.id))
        .limit(limit),
      this.db
        .select({
          amount: subscriptionPaymentOrders.amount,
          createdAt: subscriptionPaymentOrders.createdAt,
          currency: subscriptionPaymentOrders.currency,
          cycle: subscriptionPaymentOrders.cycle,
          externalOrderId: subscriptionPaymentOrders.externalOrderId,
          id: subscriptionPaymentOrders.id,
          method: subscriptionPaymentOrders.method,
          paidAt: subscriptionPaymentOrders.paidAt,
          plan: subscriptionPaymentOrders.plan,
          provider: subscriptionPaymentOrders.provider,
          snapshot: subscriptionPaymentOrders.snapshot,
          status: subscriptionPaymentOrders.status,
        })
        .from(subscriptionPaymentOrders)
        .where(eq(subscriptionPaymentOrders.userId, this.userId))
        .orderBy(desc(subscriptionPaymentOrders.createdAt), desc(subscriptionPaymentOrders.id))
        .limit(limit),
    ]);

    const topUpItems: BillingOrderHistoryItem[] = topUpOrderRows.map((order) => ({
      amount: order.amount,
      createdAt: order.createdAt,
      credits: order.credits,
      currency: order.currency,
      displayName: null,
      externalOrderId: order.externalOrderId,
      id: order.id,
      kind: 'topup',
      paidAt: order.paidAt,
      provider: order.provider,
      status: order.status,
    }));
    const subscriptionItems: BillingOrderHistoryItem[] = subscriptionOrderRows.map((order) => ({
      amount: order.amount,
      createdAt: order.createdAt,
      currency: order.currency,
      cycle: order.cycle,
      displayName: order.snapshot.displayName,
      externalOrderId: order.externalOrderId,
      id: order.id,
      kind: 'subscription',
      method: order.method,
      paidAt: order.paidAt,
      plan: order.plan,
      provider: order.provider,
      status: order.status,
    }));

    return [...topUpItems, ...subscriptionItems]
      .toSorted((left, right) => {
        const createdAtDelta = right.createdAt.getTime() - left.createdAt.getTime();
        return createdAtDelta || right.id.localeCompare(left.id);
      })
      .slice(0, limit);
  };

  listTopUpOrders = (params: QueryCommercialListParams = {}): Promise<TopUpOrderHistoryItem[]> =>
    this.topUp.listTopUpOrders(params);

  updateReferralCode = async (input: string) => {
    const code = normalizeReferralCodeValue(input.trim());
    if (!isValidReferralCode(code)) throw new Error('INVALID_REFERRAL_CODE_FORMAT');

    const profile = await this.getReferralProfile();
    if (profile.code === code) return profile;

    const existed = await this.db.query.referralProfiles.findFirst({
      where: eq(referralProfiles.code, code),
    });

    if (existed && existed.userId !== this.userId) {
      throw new Error('REFERRAL_CODE_TAKEN');
    }

    let updated;

    try {
      [updated] = await this.db
        .update(referralProfiles)
        .set({ code, updatedAt: new Date() })
        .where(eq(referralProfiles.userId, this.userId))
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new Error('REFERRAL_CODE_TAKEN', { cause: error });
      }

      throw error;
    }

    return updated || profile;
  };

  bindReferralCode = async (input: string) => {
    const code = extractReferralCodeValue(input);
    if (!isValidReferralCode(code)) throw new Error('INVALID_REFERRAL_CODE_FORMAT');

    const [currentProfile, existingRelation] = await Promise.all([
      this.getReferralProfile(),
      this.db.query.referralRelations.findFirst({
        where: eq(referralRelations.inviteeUserId, this.userId),
      }),
    ]);

    if (existingRelation) throw new Error('REFERRAL_ALREADY_BOUND');
    await this.assertReferralBackfillWindow();
    if (currentProfile.code === code) throw new Error('SELF_REFERRAL');

    const inviterProfile = await this.db.query.referralProfiles.findFirst({
      where: eq(referralProfiles.code, code),
    });

    if (!inviterProfile) throw new Error('REFERRAL_CODE_NOT_FOUND');
    if (inviterProfile.userId === this.userId) throw new Error('SELF_REFERRAL');

    let relation;

    try {
      [relation] = await this.db
        .insert(referralRelations)
        .values({
          code,
          inviteeUserId: this.userId,
          inviterUserId: inviterProfile.userId,
          rewardCredits: 0,
          status: 'registered',
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new Error('REFERRAL_ALREADY_BOUND', { cause: error });
      }

      throw error;
    }

    return relation;
  };
}
