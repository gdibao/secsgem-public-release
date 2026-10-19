// @vitest-environment node
import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  creditAccounts,
  creditDebts,
  creditLedgerEntries,
  userPlanSnapshots,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CommercialModel } from '../commercial';

const testUserId = 'precharge-test-user';
const serverDB: LobeChatDatabase = await getTestDB();

const seedActiveStarterPlan = async () => {
  await serverDB.insert(userPlanSnapshots).values({
    currency: 'USD',
    cycle: 'monthly',
    monthlyCredits: 600 * CREDITS_PER_DOLLAR,
    monthlyPrice: 19.9,
    plan: Plans.Starter,
    provider: 'manual_preview',
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    startedAt: new Date(),
    status: 'active',
    userId: testUserId,
  });
};

describe('CommercialModel preCharge/postCharge', () => {
  beforeEach(async () => {
    await serverDB.delete(creditDebts);
    await serverDB.delete(creditLedgerEntries);
    await serverDB.delete(creditAccounts);
    await serverDB.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, testUserId));
    await serverDB.delete(users).where(eq(users.id, testUserId));
    await serverDB.insert(users).values({ id: testUserId, email: 'precharge@test.com' });
    await seedActiveStarterPlan();
  });

  afterEach(async () => {
    await serverDB.delete(creditDebts);
    await serverDB.delete(creditLedgerEntries);
    await serverDB.delete(creditAccounts);
  });

  describe('preCharge', () => {
    it('should throw when balance is insufficient', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      await expect(model.preCharge(601 * CREDITS_PER_DOLLAR)).rejects.toThrow(
        'InsufficientBudgetForModel',
      );
    });

    it('should return creditAccountId when balance is sufficient', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      await model.ensureCreditAccount();
      await serverDB
        .update(creditAccounts)
        .set({ balance: 200 })
        .where(eq(creditAccounts.userId, testUserId));

      const result = await model.preCharge(100);

      expect(result).toBeDefined();
      expect(result.creditAccountId).toBe(testUserId);
    });
  });

  describe('postCharge', () => {
    it('should deduct credits and create ledger entry', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      await model.ensureCreditAccount();
      await serverDB
        .update(creditAccounts)
        .set({ balance: 200, totalCredited: 200 })
        .where(eq(creditAccounts.userId, testUserId));

      await model.postCharge({
        credits: 50,
        metadata: { usageType: 'image' },
        model: 'dall-e-3',
        provider: 'newapi',
        source: 'image',
        userId: testUserId,
      });

      const account = await serverDB.query.creditAccounts.findFirst({
        where: (a, { eq }) => eq(a.userId, testUserId),
      });
      expect(Number(account?.balance)).toBe(150);
      expect(Number(account?.totalDebited)).toBe(50);

      const ledger = await serverDB.query.creditLedgerEntries.findMany({
        where: (e, { eq }) => eq(e.userId, testUserId),
      });
      expect(ledger.length).toBe(1);
      expect(ledger[0].type).toBe('consume');
      expect(Number(ledger[0].amount)).toBe(-50);
      expect(ledger[0].metadata).toMatchObject({
        model: 'dall-e-3',
        provider: 'newapi',
        source: 'image',
        usageType: 'image',
      });
    });

    it('should not deduct twice for the same final charge reference', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      await model.ensureCreditAccount();
      await serverDB
        .update(creditAccounts)
        .set({ balance: 200, totalCredited: 200 })
        .where(eq(creditAccounts.userId, testUserId));

      const chargeParams = {
        credits: 50,
        metadata: { usageType: 'image' },
        model: 'gpt-image-2',
        provider: 'newapi',
        referenceId: 'async-task-1',
        referenceType: 'image_generation',
        source: 'image',
        userId: testUserId,
      };

      const firstCharge = await model.postCharge(chargeParams);
      await serverDB.insert(creditDebts).values({
        amount: 1,
        reason: 'test replay after refund debt',
        referenceId: 'refunded-image-lot',
        referenceType: 'top_up_order',
        userId: testUserId,
      });

      await expect(model.postCharge(chargeParams)).resolves.toMatchObject({ id: firstCharge?.id });

      const account = await serverDB.query.creditAccounts.findFirst({
        where: (a, { eq }) => eq(a.userId, testUserId),
      });
      expect(Number(account?.balance)).toBe(150);
      expect(Number(account?.totalDebited)).toBe(50);

      const ledger = await serverDB.query.creditLedgerEntries.findMany({
        where: (e, { eq }) => eq(e.userId, testUserId),
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].referenceId).toBe('async-task-1');
    });

    it('should reject final charge when balance is exhausted', async () => {
      const model = new CommercialModel(serverDB, testUserId);
      await model.ensureCreditAccount();
      await serverDB
        .update(creditAccounts)
        .set({ balance: 20, totalCredited: 20 })
        .where(eq(creditAccounts.userId, testUserId));

      await expect(
        model.postCharge({
          credits: 50,
          metadata: { usageType: 'video' },
          model: 'veo3.1-fast',
          provider: 'newapi',
          referenceId: 'async-task-1',
          referenceType: 'video_generation',
          source: 'video',
          userId: testUserId,
        }),
      ).rejects.toThrow('COMMERCIAL_BALANCE_EXHAUSTED_ON_FINAL_CHARGE');

      const account = await serverDB.query.creditAccounts.findFirst({
        where: (a, { eq }) => eq(a.userId, testUserId),
      });
      expect(Number(account?.balance)).toBe(20);

      const ledger = await serverDB.query.creditLedgerEntries.findMany({
        where: (e, { eq }) => eq(e.userId, testUserId),
      });
      expect(ledger).toHaveLength(0);
    });

    it('should enforce unique consume ledger entries for image and video final references', async () => {
      const baseLedger = {
        amount: -10,
        balanceAfter: 190,
        referenceId: 'async-task-unique',
        title: 'Final charge',
        type: 'consume' as const,
        userId: testUserId,
      };

      await serverDB.insert(creditLedgerEntries).values({
        ...baseLedger,
        referenceType: 'image_generation',
      });
      await expect(
        serverDB.insert(creditLedgerEntries).values({
          ...baseLedger,
          referenceType: 'image_generation',
        }),
      ).rejects.toThrow();

      await serverDB.insert(creditLedgerEntries).values({
        ...baseLedger,
        referenceId: 'async-video-unique',
        referenceType: 'video_generation',
      });
      await expect(
        serverDB.insert(creditLedgerEntries).values({
          ...baseLedger,
          referenceId: 'async-video-unique',
          referenceType: 'video_generation',
        }),
      ).rejects.toThrow();
    });
  });
});
