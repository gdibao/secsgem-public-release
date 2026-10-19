// @vitest-environment node
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  appSettings,
  creditAccounts,
  creditLedgerEntries,
  planCatalog,
  userPlanSnapshots,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { initNewUserForBusiness } from '../user';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'business-init-user-test-id';

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(userPlanSnapshots).where(eq(userPlanSnapshots.userId, userId));
  await serverDB.delete(creditLedgerEntries).where(eq(creditLedgerEntries.userId, userId));
  await serverDB.delete(creditAccounts).where(eq(creditAccounts.userId, userId));
  await serverDB.delete(appSettings);
  await serverDB.delete(planCatalog);
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('initNewUserForBusiness', () => {
  it('creates an active free-plan snapshot for a newly registered user', async () => {
    const createdAt = new Date('2026-05-09T00:00:00.000Z');

    await initNewUserForBusiness(serverDB, userId, createdAt);

    const snapshot = await serverDB.query.userPlanSnapshots.findFirst({
      where: eq(userPlanSnapshots.userId, userId),
    });

    expect(snapshot).toMatchObject({
      cycle: 'monthly',
      monthlyCredits: 0,
      monthlyPrice: 0,
      plan: Plans.Free,
      provider: 'system_default',
      status: 'active',
      userId,
    });
    expect(snapshot?.startedAt).toEqual(createdAt);
  });

  it('applies free-plan storage and vector quotas to the new user credit account', async () => {
    await serverDB.insert(planCatalog).values({
      currency: 'CNY',
      displayName: '免费套餐',
      features: [],
      isActive: true,
      metadata: { storageQuotaMb: 128, vectorQuota: 300 },
      monthlyCredits: 0,
      monthlyPrice: 0,
      plan: Plans.Free,
      sortOrder: 0,
      yearlyPrice: 0,
    });

    await initNewUserForBusiness(serverDB, userId, new Date('2026-05-09T00:00:00.000Z'));

    const account = await serverDB.query.creditAccounts.findFirst({
      where: eq(creditAccounts.userId, userId),
    });

    expect(Number(account?.storageQuota)).toBe(128 * 1024 * 1024);
    expect(Number(account?.vectorQuota)).toBe(300);
  });

  it('does not replace an existing active plan snapshot', async () => {
    const startedAt = new Date('2026-05-01T00:00:00.000Z');
    await serverDB.insert(userPlanSnapshots).values({
      cycle: 'monthly',
      monthlyCredits: 1000,
      monthlyPrice: 19,
      plan: Plans.Starter,
      provider: 'admin_manual',
      startedAt,
      status: 'active',
      userId,
    });

    await initNewUserForBusiness(serverDB, userId, new Date('2026-05-09T00:00:00.000Z'));

    const snapshots = await serverDB.query.userPlanSnapshots.findMany({
      where: eq(userPlanSnapshots.userId, userId),
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      plan: Plans.Starter,
      provider: 'admin_manual',
      status: 'active',
    });
  });
});
