// @vitest-environment node
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  creditAccounts,
  creditDebts,
  creditLedgerEntries,
  creditLots,
  topUpOrders,
  topUpPackages,
  userPlanSnapshots,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CommercialModel } from '../commercial';

const testUserId = 'topup-test-user';
const onlinePackageId = 'topup-online-pkg';
const serverDB: LobeChatDatabase = await getTestDB();

const seedActiveStarterPlan = async () => {
  await serverDB.insert(userPlanSnapshots).values({
    currency: 'USD',
    cycle: 'monthly',
    monthlyCredits: 0,
    monthlyPrice: 19.9,
    plan: Plans.Starter,
    provider: 'manual_preview',
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    startedAt: new Date(),
    status: 'active',
    userId: testUserId,
  });
};

describe('CommercialModel topUpOrders', () => {
  beforeEach(async () => {
    await serverDB.delete(creditDebts);
    await serverDB.delete(creditLots);
    await serverDB.delete(creditLedgerEntries);
    await serverDB.delete(topUpOrders);
    await serverDB.delete(creditAccounts);
    await serverDB.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, testUserId));
    await serverDB.delete(topUpPackages);
    await serverDB.delete(users).where(eq(users.id, testUserId));
    await serverDB.insert(users).values({ id: testUserId, email: 'topup@test.com' });
    // Insert a test package so createTopUpOrder with packageId can work
    await serverDB.insert(topUpPackages).values({
      amount: 5,
      credits: 500000000,
      currency: 'USD',
      displayName: 'Test Package',
      id: 'topup-test-pkg',
      isActive: true,
      sortOrder: 0,
      validityMonths: 12,
    });
    await serverDB.insert(topUpPackages).values({
      amount: 19.9,
      credits: 2_000_000_000,
      currency: 'CNY',
      displayName: 'Online Package',
      id: onlinePackageId,
      isActive: true,
      sortOrder: 1,
      validityMonths: 12,
    });
    // Seed a paid plan so the online-payment guard is proven independent of subscription status.
    await seedActiveStarterPlan();
  });

  afterEach(async () => {
    await serverDB.delete(creditDebts);
    await serverDB.delete(creditLots);
    await serverDB.delete(creditLedgerEntries);
    await serverDB.delete(topUpOrders);
    await serverDB.delete(creditAccounts);
  });

  describe('createTopUpOrder', () => {
    it('should create order with source=redemption without ONLINE_PAYMENT_ENABLED gate', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const order = await model.createTopUpOrder({
        packageId: 'topup-test-pkg',
        redemptionCodeId: 'code-123',
        source: 'redemption',
      });

      expect(order).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.source).toBe('redemption');
      expect(order.redemptionCodeId).toBe('code-123');
    });

    it('should reject online payment sources even for paid users', async () => {
      const model = new CommercialModel(serverDB, testUserId);

      await expect(
        model.createTopUpOrder({
          packageId: 'topup-test-pkg',
          source: 'alipay',
        }),
      ).rejects.toThrow('ONLINE_PAYMENT_DISABLED_USE_REDEMPTION_CODE');

      const orders = await serverDB.query.topUpOrders.findMany({
        where: (order, { eq }) => eq(order.userId, testUserId),
      });

      expect(orders).toHaveLength(0);
    });
  });

  describe('settleTopUpOrder', () => {
    it('should settle a pending order and write the credit ledger', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const order = await model.createTopUpOrder({
        packageId: 'topup-test-pkg',
        source: 'redemption',
      });

      const settled = await model.settleTopUpOrder(order.id);

      expect(settled.status).toBe('paid');
      expect(settled.paidAt).toBeDefined();

      const account = await serverDB.query.creditAccounts.findFirst({
        where: (a, { eq }) => eq(a.userId, testUserId),
      });
      expect(account?.balance).toBe(500000000);
      expect(account?.totalCredited).toBe(500000000);

      const ledgerEntry = await serverDB.query.creditLedgerEntries.findFirst({
        where: (entry, { eq }) => eq(entry.userId, testUserId),
      });
      expect(ledgerEntry).toMatchObject({
        amount: 500000000,
        balanceAfter: 500000000,
        referenceId: order.id,
        referenceType: 'top_up_order',
        type: 'topup',
      });
      expect(ledgerEntry?.metadata).toMatchObject({
        amount: 5,
        currency: 'USD',
        orderId: order.id,
        provider: 'redemption',
      });
    });
  });

  describe('online top-up settlement', () => {
    it('reuses an order for the same idempotency key', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const input = {
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay' as const,
        packageId: onlinePackageId,
        provider: 'wechat_pay' as const,
      };

      const first = await model.createOnlineTopUpOrder(input);
      const second = await model.createOnlineTopUpOrder(input);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.order.id).toBe(first.order.id);
      await expect(
        serverDB.query.topUpOrders.findMany({
          where: (order, { eq }) => eq(order.idempotencyKey, input.idempotencyKey),
        }),
      ).resolves.toHaveLength(1);
    });

    it('rejects an idempotency key reused with different payment parameters', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const idempotencyKey = crypto.randomUUID();
      await model.createOnlineTopUpOrder({
        idempotencyKey,
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });

      await expect(
        model.createOnlineTopUpOrder({
          idempotencyKey,
          method: 'alipay',
          packageId: onlinePackageId,
          provider: 'alipay',
        }),
      ).rejects.toThrow('TOP_UP_PAYMENT_IDEMPOTENCY_CONFLICT');
    });

    it('scopes idempotency-key recovery lookups to the current user', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const idempotencyKey = crypto.randomUUID();
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey,
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });

      await expect(
        model.getOnlineTopUpOrderByIdempotencyKey(idempotencyKey),
      ).resolves.toMatchObject({
        id: order.id,
        userId: testUserId,
      });
      await expect(
        new CommercialModel(serverDB, 'another-user').getOnlineTopUpOrderByIdempotencyKey(
          idempotencyKey,
        ),
      ).resolves.toBeUndefined();
    });

    it('claims the external provider order only once', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      const input = {
        externalOrderId: 'wechat-order-claim',
        method: 'wechat_pay' as const,
        orderId: order.id,
        provider: 'wechat_pay' as const,
      };

      await expect(model.bindOnlineTopUpPayment(input)).resolves.toMatchObject({ claimed: true });
      await expect(model.bindOnlineTopUpPayment(input)).resolves.toMatchObject({ claimed: false });
    });

    it('atomically recovers one paid refund claim with its request reference', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await serverDB
        .update(topUpOrders)
        .set({ refundReference: null, refundStatus: 'pending', status: 'paid' })
        .where(eq(topUpOrders.id, order.id));

      const claims = await Promise.all([
        model.claimOnlineTopUpRefund({
          orderId: order.id,
          refundReference: 'topup-refund-recovery-a',
        }),
        model.claimOnlineTopUpRefund({
          orderId: order.id,
          refundReference: 'topup-refund-recovery-b',
        }),
      ]);
      const wonClaims = claims.filter((claim) => claim.claimed);
      const persistedReference = wonClaims[0]?.order.refundReference;

      expect(wonClaims).toHaveLength(1);
      expect(persistedReference).toMatch(/^topup-refund-recovery-[ab]$/);
      expect(claims.every((claim) => claim.order.refundReference === persistedReference)).toBe(
        true,
      );
      await expect(
        model.claimOnlineTopUpRefund({
          orderId: order.id,
          refundReference: 'topup-refund-conflict',
        }),
      ).resolves.toMatchObject({
        claimed: false,
        order: { refundReference: persistedReference },
      });
    });

    it('does not advance a refund with a different expected request reference', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await serverDB
        .update(topUpOrders)
        .set({
          refundReference: 'topup-refund-canonical',
          refundStatus: 'pending',
          status: 'paid',
        })
        .where(eq(topUpOrders.id, order.id));

      await expect(
        model.updateOnlineTopUpRefundStatus({
          expectedRefundReference: 'topup-refund-stale',
          expectedStatus: 'pending',
          orderId: order.id,
          refundReference: 'topup-refund-replacement',
          status: 'succeeded',
        }),
      ).resolves.toMatchObject({
        refundReference: 'topup-refund-canonical',
        refundStatus: 'pending',
      });
      await expect(
        model.updateOnlineTopUpRefundStatus({
          expectedRefundReference: 'topup-refund-canonical',
          expectedStatus: 'pending',
          orderId: order.id,
          refundReference: 'topup-refund-canonical',
          status: 'succeeded',
        }),
      ).resolves.toMatchObject({
        refundReference: 'topup-refund-canonical',
        refundStatus: 'succeeded',
      });
    });

    it('atomically recovers one uncredited refund claim with its request reference', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await serverDB
        .update(topUpOrders)
        .set({ refundReference: null, refundStatus: 'pending' })
        .where(eq(topUpOrders.id, order.id));

      const claims = await Promise.all([
        model.claimUncreditedOnlineTopUpRefund({
          orderId: order.id,
          refundReference: 'topup-uncredited-refund-a',
        }),
        model.claimUncreditedOnlineTopUpRefund({
          orderId: order.id,
          refundReference: 'topup-uncredited-refund-b',
        }),
      ]);
      const wonClaims = claims.filter((claim) => claim.claimed);
      const persistedReference = wonClaims[0]?.order.refundReference;

      expect(wonClaims).toHaveLength(1);
      expect(persistedReference).toMatch(/^topup-uncredited-refund-[ab]$/);
      expect(claims.every((claim) => claim.order.refundReference === persistedReference)).toBe(
        true,
      );
    });

    it('keeps the first persisted checkout as the canonical recovery action', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      const firstCheckout = { type: 'qrcode' as const, url: 'weixin://first' };
      const secondCheckout = { type: 'qrcode' as const, url: 'weixin://second' };

      await expect(
        model.storeOnlineTopUpCheckout({ checkout: firstCheckout, orderId: order.id }),
      ).resolves.toMatchObject({ checkout: firstCheckout });
      await expect(
        model.storeOnlineTopUpCheckout({ checkout: secondCheckout, orderId: order.id }),
      ).resolves.toMatchObject({ checkout: firstCheckout });
    });

    it('credits a verified payment exactly once across duplicate callbacks', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await model.bindOnlineTopUpPayment({
        externalOrderId: 'wechat-order-1',
        method: 'wechat_pay',
        orderId: order.id,
        provider: 'wechat_pay',
      });
      const settlement = {
        amount: '19.900000',
        currency: 'CNY',
        externalOrderId: 'wechat-order-1',
        method: 'wechat_pay' as const,
        orderId: order.id,
        paymentReference: 'wechat-transaction-1',
        provider: 'wechat_pay' as const,
      };

      await expect(model.settleOnlineTopUpOrder(settlement)).resolves.toMatchObject({
        status: 'paid',
      });
      await expect(model.settleOnlineTopUpOrder(settlement)).resolves.toMatchObject({
        status: 'paid',
      });
      await expect(
        model.settleOnlineTopUpOrder({ ...settlement, amount: '19.910000' }),
      ).rejects.toThrow('TOP_UP_PAYMENT_VERIFICATION_FAILED');
      await expect(
        model.settleOnlineTopUpOrder({
          ...settlement,
          paymentReference: 'different-transaction',
        }),
      ).rejects.toThrow('TOP_UP_PAYMENT_VERIFICATION_FAILED');

      await expect(
        serverDB.query.creditLedgerEntries.findMany({
          where: (entry, { eq }) => eq(entry.referenceId, order.id),
        }),
      ).resolves.toHaveLength(1);
      await expect(
        serverDB.query.creditAccounts.findFirst({
          where: (account, { eq }) => eq(account.userId, testUserId),
        }),
      ).resolves.toMatchObject({ balance: 2_000_000_000, totalCredited: 2_000_000_000 });
    });

    it('settles a provider-authoritative late success after a local failure exactly once', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await model.bindOnlineTopUpPayment({
        externalOrderId: 'wechat-order-late-success',
        method: 'wechat_pay',
        orderId: order.id,
        provider: 'wechat_pay',
      });
      await serverDB
        .update(topUpOrders)
        .set({ status: 'failed' })
        .where(eq(topUpOrders.id, order.id));
      const settlement = {
        amount: '19.900000',
        currency: 'CNY',
        externalOrderId: 'wechat-order-late-success',
        method: 'wechat_pay' as const,
        orderId: order.id,
        paymentReference: 'wechat-transaction-late-success',
        provider: 'wechat_pay' as const,
      };

      await expect(model.settleOnlineTopUpOrder(settlement)).resolves.toMatchObject({
        status: 'paid',
      });
      await expect(model.settleOnlineTopUpOrder(settlement)).resolves.toMatchObject({
        status: 'paid',
      });
      await expect(
        serverDB.query.creditLedgerEntries.findMany({
          where: (entry, { eq }) => eq(entry.referenceId, order.id),
        }),
      ).resolves.toHaveLength(1);
    });

    it('expires unused purchased credits when their lot reaches its validity date', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await model.bindOnlineTopUpPayment({
        externalOrderId: 'wechat-order-expiry',
        method: 'wechat_pay',
        orderId: order.id,
        provider: 'wechat_pay',
      });
      await model.settleOnlineTopUpOrder({
        amount: '19.900000',
        currency: 'CNY',
        externalOrderId: 'wechat-order-expiry',
        method: 'wechat_pay',
        orderId: order.id,
        paymentReference: 'wechat-transaction-expiry',
        provider: 'wechat_pay',
      });
      await serverDB
        .update(creditLots)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(creditLots.referenceId, order.id));

      await model.getCreditAccountSummary();

      await expect(
        serverDB.query.creditAccounts.findFirst({
          where: eq(creditAccounts.userId, testUserId),
        }),
      ).resolves.toMatchObject({ balance: 0 });
      await expect(
        serverDB.query.creditLots.findFirst({ where: eq(creditLots.referenceId, order.id) }),
      ).resolves.toMatchObject({ expiredAmount: 2_000_000_000, status: 'expired' });
    });

    it('records debt when a refund reverses already-consumed purchased credits', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await model.bindOnlineTopUpPayment({
        externalOrderId: 'wechat-order-refund',
        method: 'wechat_pay',
        orderId: order.id,
        provider: 'wechat_pay',
      });
      await model.settleOnlineTopUpOrder({
        amount: '19.900000',
        currency: 'CNY',
        externalOrderId: 'wechat-order-refund',
        method: 'wechat_pay',
        orderId: order.id,
        paymentReference: 'wechat-transaction-refund',
        provider: 'wechat_pay',
      });
      await model.postCharge({
        credits: 500_000_000,
        model: 'test-model',
        provider: 'test-provider',
        source: 'top-up-refund-test',
        userId: testUserId,
      });

      await expect(
        model.refundOnlineTopUpOrder({
          amount: '19.900000',
          method: 'wechat_pay',
          orderId: order.id,
          provider: 'wechat_pay',
          refundReference: 'refund-1',
        }),
      ).resolves.toMatchObject({ debtAmount: 500_000_000 });
      await expect(
        serverDB.query.creditDebts.findFirst({ where: eq(creditDebts.userId, testUserId) }),
      ).resolves.toMatchObject({ amount: 500_000_000, status: 'open' });
    });

    it('reconstructs a legacy paid top-up lot before refunding it', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const { order } = await model.createOnlineTopUpOrder({
        idempotencyKey: crypto.randomUUID(),
        method: 'wechat_pay',
        packageId: onlinePackageId,
        provider: 'wechat_pay',
      });
      await model.bindOnlineTopUpPayment({
        externalOrderId: 'wechat-order-legacy-refund',
        method: 'wechat_pay',
        orderId: order.id,
        provider: 'wechat_pay',
      });
      await model.settleOnlineTopUpOrder({
        amount: '19.900000',
        currency: 'CNY',
        externalOrderId: 'wechat-order-legacy-refund',
        method: 'wechat_pay',
        orderId: order.id,
        paymentReference: 'wechat-transaction-legacy-refund',
        provider: 'wechat_pay',
      });
      await serverDB.delete(creditLots).where(eq(creditLots.referenceId, order.id));
      await serverDB
        .update(creditAccounts)
        .set({
          balance: 1_500_000_000,
          totalDebited: 500_000_000,
        })
        .where(eq(creditAccounts.userId, testUserId));
      await serverDB.insert(creditLedgerEntries).values({
        amount: -500_000_000,
        balanceAfter: 1_500_000_000,
        metadata: {},
        referenceId: 'legacy-consume',
        referenceType: 'ai_usage',
        title: 'Legacy Usage',
        type: 'consume',
        userId: testUserId,
      });

      await expect(
        model.refundOnlineTopUpOrder({
          amount: '19.900000',
          method: 'wechat_pay',
          orderId: order.id,
          provider: 'wechat_pay',
          refundReference: 'legacy-refund-1',
        }),
      ).resolves.toMatchObject({ debtAmount: 500_000_000, removedAmount: 1_500_000_000 });
      await expect(
        serverDB.query.creditLots.findFirst({ where: eq(creditLots.referenceId, order.id) }),
      ).resolves.toMatchObject({
        consumedAmount: 500_000_000,
        refundedAmount: 1_500_000_000,
        status: 'refunded',
      });
      await expect(
        serverDB.query.creditAccounts.findFirst({
          where: eq(creditAccounts.userId, testUserId),
        }),
      ).resolves.toMatchObject({ balance: 0 });
      await expect(
        serverDB.query.creditDebts.findFirst({ where: eq(creditDebts.userId, testUserId) }),
      ).resolves.toMatchObject({ amount: 500_000_000, status: 'open' });
    });
  });

  describe('updateAutoTopUpSetting', () => {
    it('validates the target before resolving the current plan', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const getCurrentPlan = vi.spyOn(model, 'getCurrentPlan');

      await expect(
        model.updateAutoTopUpSetting({
          enabled: true,
          monthlyLimit: null,
          targetBalance: 100,
          threshold: 100,
        }),
      ).rejects.toThrow('AUTO_TOP_UP_TARGET_NOT_EXCEED_THRESHOLD');

      expect(getCurrentPlan).not.toHaveBeenCalled();
    });

    it('rejects enabling auto top-up until recurring payment authorization is available', async () => {
      const model = new CommercialModel(serverDB, testUserId);

      await expect(
        model.updateAutoTopUpSetting({
          enabled: true,
          monthlyLimit: null,
          targetBalance: 120_000_000,
          threshold: 40_000_000,
        }),
      ).rejects.toThrow('AUTO_TOP_UP_RECURRING_PAYMENT_UNAVAILABLE');
    });
  });

  describe('cancelTopUpOrder', () => {
    it('should cancel a pending order', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      const order = await model.createTopUpOrder({
        packageId: 'topup-test-pkg',
        source: 'redemption',
      });

      const canceled = await model.cancelTopUpOrder(order.id);

      expect(canceled.status).toBe('canceled');
    });
  });
});
