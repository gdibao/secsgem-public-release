import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import type {
  AutoTopUpSetting,
  CreateTopUpOrderParams,
  ModuleAppNormalizedPaymentEvent,
  PaymentCheckoutAction,
  PaymentMethodId,
  PaymentProvider,
  QueryCommercialListParams,
  TopUpOrderHistoryItem,
  TopUpPackageItem,
} from '@lobechat/types';
import {
  AUTO_TOP_UP_AVAILABLE,
  AUTO_TOP_UP_RECURRING_PAYMENT_UNAVAILABLE_ERROR,
  Plans,
} from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import {
  autoTopUpSettings,
  creditAccounts,
  creditLedgerEntries,
  defaultAutoTopUpSetting,
  topUpOrders,
  topUpPackages,
  topUpPaymentEvents,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { addCalendarMonths } from './calendar';
import { CreditLotModel } from './creditLot';

const DISPLAY_CREDITS_UNIT = CREDITS_PER_DOLLAR;
const MIN_CUSTOM_TOP_UP_DISPLAY_CREDITS = 50;
const MAX_CUSTOM_TOP_UP_DISPLAY_CREDITS = 5000;
const MAX_TOP_UP_AMOUNT = 500;
const CUSTOM_TOP_UP_UNIT_PRICE = 0.1;
const TOP_UP_CURRENCY = 'USD';
const TOP_UP_VALIDITY_MONTHS = 12;
const ONLINE_PAYMENT_DISABLED_ERROR = 'ONLINE_PAYMENT_DISABLED_USE_REDEMPTION_CODE';
const ONLINE_TOP_UP_ORDER_TTL_MS = 30 * 60 * 1000;

const resolveValidityMonths = (metadata?: Record<string, unknown> | null) => {
  const value = Number(metadata?.validityMonths);
  return Number.isInteger(value) && value > 0 ? value : TOP_UP_VALIDITY_MONTHS;
};

const DEFAULT_TOP_UP_PACKAGES: TopUpPackageItem[] = [
  {
    amount: 9.9,
    credits: 100 * DISPLAY_CREDITS_UNIT,
    currency: TOP_UP_CURRENCY,
    id: 'starter',
    validityMonths: TOP_UP_VALIDITY_MONTHS,
  },
  {
    amount: 27,
    credits: 300 * DISPLAY_CREDITS_UNIT,
    currency: TOP_UP_CURRENCY,
    id: 'growth',
    recommended: true,
    validityMonths: TOP_UP_VALIDITY_MONTHS,
  },
  {
    amount: 68,
    credits: 800 * DISPLAY_CREDITS_UNIT,
    currency: TOP_UP_CURRENCY,
    id: 'scale',
    validityMonths: TOP_UP_VALIDITY_MONTHS,
  },
];

const topUpOrderHistoryColumns = {
  amount: topUpOrders.amount,
  createdAt: topUpOrders.createdAt,
  credits: topUpOrders.credits,
  creditsExpiresAt: topUpOrders.creditsExpiresAt,
  currency: topUpOrders.currency,
  externalOrderId: topUpOrders.externalOrderId,
  expiresAt: topUpOrders.expiresAt,
  id: topUpOrders.id,
  paidAt: topUpOrders.paidAt,
  provider: topUpOrders.provider,
  redemptionCodeId: topUpOrders.redemptionCodeId,
  refundedAt: topUpOrders.refundedAt,
  refundAmount: topUpOrders.refundAmount,
  refundReference: topUpOrders.refundReference,
  refundStatus: topUpOrders.refundStatus,
  source: topUpOrders.source,
  status: topUpOrders.status,
};

const isRedemptionTopUpOrder = (order: {
  provider?: string | null;
  redemptionCodeId?: string | null;
  source?: string | null;
}) => order.source === 'redemption' || order.provider === 'redemption' || !!order.redemptionCodeId;

export class CommercialTopUpModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private ensureCreditAccount = async (db: LobeChatDatabase | Transaction = this.db) => {
    return db.insert(creditAccounts).values({ userId: this.userId }).onConflictDoNothing();
  };

  private createCustomTopUpPackage = (credits: number): TopUpPackageItem => {
    const displayCredits = credits / DISPLAY_CREDITS_UNIT;
    const amount = Number((displayCredits * CUSTOM_TOP_UP_UNIT_PRICE).toFixed(2));

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('TOP_UP_INVALID_CREDITS');
    }

    if (
      credits < MIN_CUSTOM_TOP_UP_DISPLAY_CREDITS * DISPLAY_CREDITS_UNIT ||
      credits > MAX_CUSTOM_TOP_UP_DISPLAY_CREDITS * DISPLAY_CREDITS_UNIT
    ) {
      throw new Error('TOP_UP_INVALID_CREDITS');
    }

    if (amount > MAX_TOP_UP_AMOUNT) {
      throw new Error('TOP_UP_AMOUNT_EXCEEDS_MAX');
    }

    return {
      amount,
      credits,
      currency: TOP_UP_CURRENCY,
      id: `custom-${credits}`,
      validityMonths: TOP_UP_VALIDITY_MONTHS,
    };
  };

  private resolveTopUpPackage = async (
    input: Pick<CreateTopUpOrderParams, 'credits' | 'packageId'>,
  ): Promise<TopUpPackageItem | undefined> => {
    if (input.packageId) {
      const dbRow = await this.db.query.topUpPackages.findFirst({
        where: and(eq(topUpPackages.id, input.packageId), eq(topUpPackages.isActive, true)),
      });
      return dbRow
        ? {
            amount: Number(dbRow.amount),
            credits: Number(dbRow.credits),
            currency: dbRow.currency,
            id: dbRow.id,
            recommended: dbRow.recommended || undefined,
            validityMonths: Number(dbRow.validityMonths),
          }
        : DEFAULT_TOP_UP_PACKAGES.find((item) => item.id === input.packageId);
    }
    if (input.credits) return this.createCustomTopUpPackage(input.credits);
  };

  getAutoTopUpSetting = async (): Promise<AutoTopUpSetting> => {
    const setting = await this.db.query.autoTopUpSettings.findFirst({
      where: eq(autoTopUpSettings.userId, this.userId),
    });

    if (!setting) return defaultAutoTopUpSetting;

    return {
      enabled: AUTO_TOP_UP_AVAILABLE && setting.enabled,
      monthlyLimit: setting.monthlyLimit,
      monthlyTopUpAmount: setting.monthlyTopUpAmount ?? 0,
      targetBalance: setting.targetBalance ?? defaultAutoTopUpSetting.targetBalance,
      threshold: setting.threshold ?? defaultAutoTopUpSetting.threshold,
      updatedAt: setting.updatedAt,
    };
  };

  updateAutoTopUpSetting = async (
    input: Pick<AutoTopUpSetting, 'enabled' | 'monthlyLimit' | 'targetBalance' | 'threshold'>,
    getCurrentPlan: () => Promise<Plans>,
  ): Promise<AutoTopUpSetting> => {
    if (input.targetBalance <= input.threshold) {
      throw new Error('AUTO_TOP_UP_TARGET_NOT_EXCEED_THRESHOLD');
    }

    if (input.enabled && !AUTO_TOP_UP_AVAILABLE) {
      throw new Error(AUTO_TOP_UP_RECURRING_PAYMENT_UNAVAILABLE_ERROR);
    }

    const currentPlan = await getCurrentPlan();
    if (input.enabled && currentPlan === Plans.Free) {
      throw new Error('AUTO_TOP_UP_REQUIRES_PAID_PLAN');
    }

    await this.db
      .insert(autoTopUpSettings)
      .values({
        enabled: input.enabled,
        monthlyLimit: input.monthlyLimit ?? null,
        targetBalance: input.targetBalance,
        threshold: input.threshold,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          enabled: input.enabled,
          monthlyLimit: input.monthlyLimit ?? null,
          targetBalance: input.targetBalance,
          threshold: input.threshold,
          updatedAt: new Date(),
        },
        target: autoTopUpSettings.userId,
      });

    return this.getAutoTopUpSetting();
  };

  listTopUpPackages = async (): Promise<TopUpPackageItem[]> => {
    const rows = await this.db.query.topUpPackages.findMany({
      orderBy: asc(topUpPackages.sortOrder),
      where: eq(topUpPackages.isActive, true),
    });

    return rows.map((row) => ({
      amount: Number(row.amount),
      credits: Number(row.credits),
      currency: row.currency,
      displayName: row.displayName,
      id: row.id,
      metadata: row.metadata ?? null,
      recommended: row.recommended || undefined,
      validityMonths: Number(row.validityMonths),
    }));
  };

  createTopUpOrder = async (input: CreateTopUpOrderParams): Promise<TopUpOrderHistoryItem> => {
    if (input.source !== 'redemption') {
      throw new Error(ONLINE_PAYMENT_DISABLED_ERROR);
    }

    const packageItem = await this.resolveTopUpPackage(input);

    if (!packageItem) {
      throw new Error('TOP_UP_PACKAGE_NOT_FOUND');
    }

    if (packageItem.amount > MAX_TOP_UP_AMOUNT) {
      throw new Error('TOP_UP_AMOUNT_EXCEEDS_MAX');
    }

    const [order] = await this.db
      .insert(topUpOrders)
      .values({
        amount: packageItem.amount,
        credits: packageItem.credits,
        currency: packageItem.currency,
        metadata: {
          packageId: packageItem.id,
          validityMonths: packageItem.validityMonths,
        },
        provider: input.source === 'redemption' ? 'redemption' : (input.source ?? null),
        redemptionCodeId: input.redemptionCodeId ?? null,
        source: input.source ?? null,
        status: 'pending',
        userId: this.userId,
      })
      .returning(topUpOrderHistoryColumns);

    return order;
  };

  createOnlineTopUpOrder = async (input: {
    idempotencyKey: string;
    method: PaymentMethodId;
    packageId: string;
    provider: PaymentProvider;
  }) => {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error('TOP_UP_PAYMENT_IDEMPOTENCY_KEY_REQUIRED');

    const assertMatchingOrder = (order: typeof topUpOrders.$inferSelect) => {
      if (
        order.currency !== 'CNY' ||
        order.provider !== input.provider ||
        order.metadata?.method !== input.method ||
        order.metadata?.packageId !== input.packageId
      ) {
        throw new Error('TOP_UP_PAYMENT_IDEMPOTENCY_CONFLICT');
      }

      return { ...order, currency: 'CNY' as const, idempotencyKey };
    };

    const existing = await this.db.query.topUpOrders.findFirst({
      where: and(
        eq(topUpOrders.userId, this.userId),
        eq(topUpOrders.idempotencyKey, idempotencyKey),
      ),
    });
    if (existing) return { created: false, order: assertMatchingOrder(existing) };

    const packageItem = await this.resolveTopUpPackage(input);
    if (!packageItem) throw new Error('TOP_UP_PACKAGE_NOT_FOUND');
    if (packageItem.currency !== 'CNY') throw new Error('TOP_UP_CURRENCY_UNSUPPORTED');
    if (packageItem.amount <= 0 || packageItem.amount > MAX_TOP_UP_AMOUNT) {
      throw new Error('TOP_UP_AMOUNT_EXCEEDS_MAX');
    }
    const amountInFen = Math.round(packageItem.amount * 100);
    if (
      !Number.isSafeInteger(amountInFen) ||
      Math.abs(packageItem.amount * 100 - amountInFen) > 0.000_001
    ) {
      throw new Error('TOP_UP_AMOUNT_PRECISION_UNSUPPORTED');
    }
    const [order] = await this.db
      .insert(topUpOrders)
      .values({
        amount: packageItem.amount,
        credits: packageItem.credits,
        currency: packageItem.currency,
        expiresAt: new Date(Date.now() + ONLINE_TOP_UP_ORDER_TTL_MS),
        idempotencyKey,
        metadata: {
          method: input.method,
          packageId: packageItem.id,
          validityMonths: packageItem.validityMonths,
        },
        provider: input.provider,
        source: input.provider,
        status: 'pending',
        userId: this.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (order) return { created: true, order: assertMatchingOrder(order) };

    const concurrentOrder = await this.db.query.topUpOrders.findFirst({
      where: and(
        eq(topUpOrders.userId, this.userId),
        eq(topUpOrders.idempotencyKey, idempotencyKey),
      ),
    });
    if (!concurrentOrder) throw new Error('TOP_UP_PAYMENT_ORDER_CREATE_FAILED');
    return { created: false, order: assertMatchingOrder(concurrentOrder) };
  };

  bindOnlineTopUpPayment = async (input: {
    externalOrderId: string;
    method: PaymentMethodId;
    orderId: string;
    provider: PaymentProvider;
  }) => {
    const [updated] = await this.db
      .update(topUpOrders)
      .set({
        externalOrderId: input.externalOrderId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          eq(topUpOrders.status, 'pending'),
          eq(topUpOrders.provider, input.provider),
          sql`${topUpOrders.metadata} ->> 'method' = ${input.method}`,
          isNull(topUpOrders.externalOrderId),
        ),
      )
      .returning();
    if (updated) return { claimed: true, order: updated };

    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
    });
    if (!order) throw new Error('TOP_UP_ORDER_NOT_FOUND');
    if (
      order.status !== 'pending' ||
      order.provider !== input.provider ||
      order.metadata?.method !== input.method ||
      order.externalOrderId !== input.externalOrderId
    ) {
      throw new Error('TOP_UP_PAYMENT_BIND_CONFLICT');
    }
    return { claimed: false, order };
  };

  storeOnlineTopUpCheckout = async (input: {
    checkout: PaymentCheckoutAction;
    orderId: string;
  }) => {
    const [updated] = await this.db
      .update(topUpOrders)
      .set({ checkout: input.checkout, updatedAt: new Date() })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          isNull(topUpOrders.checkout),
        ),
      )
      .returning();
    if (updated) return updated;

    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
    });
    if (!order) throw new Error('TOP_UP_ORDER_NOT_FOUND');
    if (!order.checkout) throw new Error('TOP_UP_PAYMENT_CHECKOUT_STORE_FAILED');
    return order;
  };

  cancelTopUpOrder = async (orderId: string): Promise<TopUpOrderHistoryItem> => {
    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, orderId), eq(topUpOrders.userId, this.userId)),
    });

    if (!order) {
      throw new Error('TOP_UP_ORDER_NOT_FOUND');
    }

    if (!isRedemptionTopUpOrder(order)) {
      throw new Error(ONLINE_PAYMENT_DISABLED_ERROR);
    }

    if (order.status !== 'pending') {
      throw new Error('TOP_UP_ORDER_NOT_CANCELABLE');
    }

    const [updated] = await this.db
      .update(topUpOrders)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(and(eq(topUpOrders.id, orderId), eq(topUpOrders.userId, this.userId)))
      .returning(topUpOrderHistoryColumns);

    if (!updated) {
      throw new Error('TOP_UP_ORDER_NOT_FOUND');
    }

    return updated;
  };

  settleTopUpOrder = async (orderId: string): Promise<TopUpOrderHistoryItem> => {
    return this.db.transaction(async (tx) => {
      const order = await tx.query.topUpOrders.findFirst({
        where: and(eq(topUpOrders.id, orderId), eq(topUpOrders.userId, this.userId)),
      });

      if (!order) {
        throw new Error('TOP_UP_ORDER_NOT_FOUND');
      }

      if (!isRedemptionTopUpOrder(order)) {
        throw new Error(ONLINE_PAYMENT_DISABLED_ERROR);
      }

      if (order.status !== 'pending') {
        throw new Error('TOP_UP_ORDER_NOT_SETTLEABLE');
      }

      await this.ensureCreditAccount(tx);

      const settledAt = new Date();
      const creditsExpiresAt = addCalendarMonths(settledAt, resolveValidityMonths(order.metadata));
      const [updatedOrder] = await tx
        .update(topUpOrders)
        .set({ creditsExpiresAt, paidAt: settledAt, status: 'paid', updatedAt: settledAt })
        .where(
          and(
            eq(topUpOrders.id, orderId),
            eq(topUpOrders.userId, this.userId),
            eq(topUpOrders.status, 'pending'),
          ),
        )
        .returning(topUpOrderHistoryColumns);

      if (!updatedOrder) {
        throw new Error('TOP_UP_ORDER_NOT_SETTLEABLE');
      }

      const [account] = await tx
        .update(creditAccounts)
        .set({
          balance: sql`${creditAccounts.balance} + ${order.credits}`,
          totalCredited: sql`${creditAccounts.totalCredited} + ${order.credits}`,
          updatedAt: settledAt,
        })
        .where(eq(creditAccounts.userId, this.userId))
        .returning({
          balance: creditAccounts.balance,
        });

      if (!account) {
        throw new Error('TOP_UP_ACCOUNT_UPDATE_FAILED');
      }

      const [ledger] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: order.credits,
          balanceAfter: account.balance,
          description: `Activated ${order.credits} credits from order ${order.id.slice(0, 8).toUpperCase()}`,
          metadata: {
            amount: order.amount,
            creditsExpiresAt: creditsExpiresAt.toISOString(),
            currency: order.currency,
            orderId: order.id,
            provider: order.provider,
          },
          referenceId: order.id,
          referenceType: 'top_up_order',
          title: 'Top-up Order',
          type: 'topup',
          userId: this.userId,
        })
        .returning({ id: creditLedgerEntries.id });
      if (!ledger) throw new Error('TOP_UP_LEDGER_CREATE_FAILED');
      await new CreditLotModel(this.db, this.userId).createLot(
        {
          amount: Number(order.credits),
          expiresAt: creditsExpiresAt,
          grantLedgerEntryId: ledger.id,
          referenceId: order.id,
          referenceType: 'top_up_order',
          source: 'topup',
        },
        tx,
      );

      return updatedOrder;
    });
  };

  getTopUpOrder = async (orderId: string): Promise<TopUpOrderHistoryItem | null> => {
    const [order] = await this.db
      .select(topUpOrderHistoryColumns)
      .from(topUpOrders)
      .where(and(eq(topUpOrders.id, orderId), eq(topUpOrders.userId, this.userId)))
      .limit(1);
    return order ?? null;
  };

  getOnlineTopUpOrderByIdempotencyKey = async (idempotencyKey: string) => {
    return this.db.query.topUpOrders.findFirst({
      where: and(
        eq(topUpOrders.userId, this.userId),
        eq(topUpOrders.idempotencyKey, idempotencyKey.trim()),
      ),
    });
  };

  settleOnlineTopUpOrder = async (input: {
    amount: string;
    currency: string;
    externalOrderId: string;
    method: PaymentMethodId;
    orderId: string;
    paymentReference?: string;
    provider: PaymentProvider;
  }): Promise<TopUpOrderHistoryItem> => {
    return this.db.transaction(async (tx) => {
      const order = await tx.query.topUpOrders.findFirst({
        where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
      });
      if (!order) throw new Error('TOP_UP_ORDER_NOT_FOUND');
      const storedPaymentReference = order.metadata?.paymentReference;
      if (
        isRedemptionTopUpOrder(order) ||
        order.provider !== input.provider ||
        order.externalOrderId !== input.externalOrderId ||
        order.currency !== input.currency ||
        Number(order.amount).toFixed(6) !== Number(input.amount).toFixed(6) ||
        order.metadata?.method !== input.method ||
        (typeof storedPaymentReference === 'string' &&
          input.paymentReference &&
          storedPaymentReference !== input.paymentReference)
      ) {
        throw new Error('TOP_UP_PAYMENT_VERIFICATION_FAILED');
      }
      if (order.status === 'paid') return order;
      if (!['expired', 'failed', 'pending'].includes(order.status)) {
        throw new Error('TOP_UP_ORDER_NOT_SETTLEABLE');
      }

      await this.ensureCreditAccount(tx);
      const settledAt = new Date();
      const creditsExpiresAt = addCalendarMonths(settledAt, resolveValidityMonths(order.metadata));
      const [updatedOrder] = await tx
        .update(topUpOrders)
        .set({
          creditsExpiresAt,
          metadata: {
            ...order.metadata,
            ...(input.paymentReference ? { paymentReference: input.paymentReference } : {}),
          },
          paidAt: settledAt,
          status: 'paid',
          updatedAt: settledAt,
        })
        .where(
          and(
            eq(topUpOrders.id, input.orderId),
            eq(topUpOrders.userId, this.userId),
            inArray(topUpOrders.status, ['pending', 'failed', 'expired']),
          ),
        )
        .returning(topUpOrderHistoryColumns);
      if (!updatedOrder) {
        const [alreadySettled] = await tx
          .select(topUpOrderHistoryColumns)
          .from(topUpOrders)
          .where(
            and(
              eq(topUpOrders.id, input.orderId),
              eq(topUpOrders.userId, this.userId),
              eq(topUpOrders.status, 'paid'),
            ),
          )
          .limit(1);
        if (alreadySettled) return alreadySettled;
        throw new Error('TOP_UP_ORDER_NOT_SETTLEABLE');
      }

      const [account] = await tx
        .update(creditAccounts)
        .set({
          balance: sql`${creditAccounts.balance} + ${order.credits}`,
          totalCredited: sql`${creditAccounts.totalCredited} + ${order.credits}`,
          updatedAt: settledAt,
        })
        .where(eq(creditAccounts.userId, this.userId))
        .returning({ balance: creditAccounts.balance });
      if (!account) throw new Error('TOP_UP_ACCOUNT_UPDATE_FAILED');

      const [ledger] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: order.credits,
          balanceAfter: account.balance,
          description: `Purchased ${order.credits} credits from order ${order.id.slice(0, 8).toUpperCase()}`,
          metadata: {
            amount: order.amount,
            creditsExpiresAt: creditsExpiresAt.toISOString(),
            currency: order.currency,
            method: input.method,
            orderId: order.id,
            provider: input.provider,
          },
          referenceId: order.id,
          referenceType: 'top_up_order',
          title: 'Top-up Order',
          type: 'topup',
          userId: this.userId,
        })
        .returning({ id: creditLedgerEntries.id });
      if (!ledger) throw new Error('TOP_UP_LEDGER_CREATE_FAILED');
      await new CreditLotModel(this.db, this.userId).createLot(
        {
          amount: Number(order.credits),
          expiresAt: creditsExpiresAt,
          grantLedgerEntryId: ledger.id,
          referenceId: order.id,
          referenceType: 'top_up_order',
          source: 'topup',
        },
        tx,
      );
      return updatedOrder;
    });
  };

  expireOnlineTopUpOrder = async (orderId: string) => {
    const now = new Date();
    const [expired] = await this.db
      .update(topUpOrders)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(topUpOrders.id, orderId),
          eq(topUpOrders.userId, this.userId),
          eq(topUpOrders.status, 'pending'),
          lte(topUpOrders.expiresAt, now),
        ),
      )
      .returning();
    return expired ?? null;
  };

  recordOnlineTopUpPaymentEvent = async (event: ModuleAppNormalizedPaymentEvent) => {
    const [created] = await this.db
      .insert(topUpPaymentEvents)
      .values({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        outTradeNo: event.outTradeNo,
        payload: { ...event, occurredAt: event.occurredAt.toISOString() },
        provider: event.provider,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { duplicate: false, event: created };

    const existing = await this.db.query.topUpPaymentEvents.findFirst({
      where: and(
        eq(topUpPaymentEvents.provider, event.provider),
        eq(topUpPaymentEvents.eventId, event.eventId),
      ),
    });
    if (!existing) throw new Error('TOP_UP_PAYMENT_EVENT_RECORD_FAILED');
    return { duplicate: true, event: existing };
  };

  updateOnlineTopUpPaymentEvent = async (input: {
    errorCode?: string | null;
    eventId: string;
    orderId?: string | null;
    provider: PaymentProvider;
    status: 'failed' | 'ignored' | 'processed' | 'received' | 'rejected';
  }) => {
    const now = new Date();
    const [updated] = await this.db
      .update(topUpPaymentEvents)
      .set({
        errorCode: input.errorCode ?? null,
        orderId: input.orderId ?? null,
        processedAt: input.status === 'received' ? null : now,
        status: input.status,
        updatedAt: now,
      })
      .where(
        and(
          eq(topUpPaymentEvents.provider, input.provider),
          eq(topUpPaymentEvents.eventId, input.eventId),
        ),
      )
      .returning();
    if (!updated) throw new Error('TOP_UP_PAYMENT_EVENT_UPDATE_FAILED');
    return updated;
  };

  refundOnlineTopUpOrder = async (input: {
    amount: string;
    method: PaymentMethodId;
    orderId: string;
    provider: PaymentProvider;
    refundReference: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(topUpOrders)
        .where(and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)))
        .for('update');
      if (!order) throw new Error('TOP_UP_ORDER_NOT_FOUND');
      if (
        order.provider !== input.provider ||
        order.metadata?.method !== input.method ||
        Number(order.amount).toFixed(6) !== Number(input.amount).toFixed(6)
      ) {
        throw new Error('TOP_UP_PAYMENT_VERIFICATION_FAILED');
      }
      if (order.status === 'refunded') return { debtAmount: 0, order };
      if (order.status !== 'paid') throw new Error('TOP_UP_ORDER_NOT_REFUNDABLE');

      const reversal = await new CreditLotModel(this.db, this.userId).refundLot(
        {
          metadata: { provider: input.provider, refundReference: input.refundReference },
          referenceId: order.id,
          referenceType: 'top_up_order',
        },
        tx,
      );
      const refundedAt = new Date();
      const [refunded] = await tx
        .update(topUpOrders)
        .set({
          refundAmount: order.amount,
          refundedAt,
          refundReference: input.refundReference,
          refundStatus: 'succeeded',
          status: 'refunded',
          updatedAt: refundedAt,
        })
        .where(and(eq(topUpOrders.id, order.id), eq(topUpOrders.status, 'paid')))
        .returning(topUpOrderHistoryColumns);
      if (!refunded) throw new Error('TOP_UP_REFUND_REVERSAL_FAILED');
      return { ...reversal, order: refunded };
    });
  };

  claimOnlineTopUpRefund = async (input: { orderId: string; refundReference: string }) => {
    const refundReference = input.refundReference.trim();
    if (!refundReference) throw new Error('TOP_UP_PAYMENT_REFUND_REFERENCE_REQUIRED');

    const [claimed] = await this.db
      .update(topUpOrders)
      .set({ refundReference, refundStatus: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          eq(topUpOrders.status, 'paid'),
          or(
            and(
              or(isNull(topUpOrders.refundStatus), eq(topUpOrders.refundStatus, 'failed')),
              or(
                isNull(topUpOrders.refundReference),
                eq(topUpOrders.refundReference, refundReference),
              ),
            ),
            and(eq(topUpOrders.refundStatus, 'pending'), isNull(topUpOrders.refundReference)),
          ),
        ),
      )
      .returning();
    if (claimed) return { claimed: true as const, order: claimed };

    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
    });
    if (!order) throw new Error('TOP_UP_PAYMENT_ORDER_NOT_FOUND');
    return { claimed: false as const, order };
  };

  claimUncreditedOnlineTopUpRefund = async (input: {
    orderId: string;
    refundReference: string;
  }) => {
    const refundReference = input.refundReference.trim();
    if (!refundReference) throw new Error('TOP_UP_PAYMENT_REFUND_REFERENCE_REQUIRED');

    const [claimed] = await this.db
      .update(topUpOrders)
      .set({ refundReference, refundStatus: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          inArray(topUpOrders.status, ['canceled', 'expired', 'failed', 'pending']),
          or(
            and(
              or(isNull(topUpOrders.refundStatus), eq(topUpOrders.refundStatus, 'failed')),
              or(
                isNull(topUpOrders.refundReference),
                eq(topUpOrders.refundReference, refundReference),
              ),
            ),
            and(eq(topUpOrders.refundStatus, 'pending'), isNull(topUpOrders.refundReference)),
          ),
        ),
      )
      .returning();
    if (claimed) return { claimed: true as const, order: claimed };

    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
    });
    if (!order) throw new Error('TOP_UP_PAYMENT_ORDER_NOT_FOUND');
    return { claimed: false as const, order };
  };

  markUncreditedOnlineTopUpRefunded = async (input: {
    orderId: string;
    refundReference: string;
  }) => {
    const refundedAt = new Date();
    const [updated] = await this.db
      .update(topUpOrders)
      .set({
        refundAmount: sql`${topUpOrders.amount}`,
        refundedAt,
        refundReference: input.refundReference,
        refundStatus: 'succeeded',
        status: 'refunded',
        updatedAt: refundedAt,
      })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          inArray(topUpOrders.status, ['canceled', 'expired', 'failed', 'pending']),
        ),
      )
      .returning(topUpOrderHistoryColumns);
    return updated ?? null;
  };

  updateOnlineTopUpRefundStatus = async (input: {
    expectedRefundReference: null | string;
    expectedStatus: 'failed' | 'pending' | 'succeeded';
    orderId: string;
    refundReference: string;
    status: 'failed' | 'pending' | 'succeeded';
  }) => {
    const [updated] = await this.db
      .update(topUpOrders)
      .set({
        refundReference: input.refundReference,
        refundStatus: input.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(topUpOrders.id, input.orderId),
          eq(topUpOrders.userId, this.userId),
          input.expectedRefundReference === null
            ? isNull(topUpOrders.refundReference)
            : eq(topUpOrders.refundReference, input.expectedRefundReference),
          eq(topUpOrders.refundStatus, input.expectedStatus),
          inArray(topUpOrders.status, ['canceled', 'expired', 'failed', 'paid', 'pending']),
        ),
      )
      .returning();
    if (updated) return updated;

    const order = await this.db.query.topUpOrders.findFirst({
      where: and(eq(topUpOrders.id, input.orderId), eq(topUpOrders.userId, this.userId)),
    });
    if (!order) throw new Error('TOP_UP_ORDER_NOT_FOUND');
    return order;
  };

  listTopUpOrders = async (
    params: QueryCommercialListParams = {},
  ): Promise<TopUpOrderHistoryItem[]> => {
    const { limit = 20 } = params;

    return this.db
      .select({
        ...topUpOrderHistoryColumns,
      })
      .from(topUpOrders)
      .where(eq(topUpOrders.userId, this.userId))
      .orderBy(desc(topUpOrders.createdAt), desc(topUpOrders.id))
      .limit(limit);
  };
}
