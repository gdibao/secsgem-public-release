// @vitest-environment node
import { Plans } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { userPlanSnapshots, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { syncExpiredSubscriptionsToFree } from '../subscriptionMaintenance';

const serverDB: LobeChatDatabase = await getTestDB();
const expiredUserId = 'subscription-maintenance-expired-user';
const activeUserId = 'subscription-maintenance-active-user';

afterEach(async () => {
  await serverDB
    .delete(userPlanSnapshots)
    .where(inArray(userPlanSnapshots.userId, [expiredUserId, activeUserId]));
  await serverDB.delete(users).where(inArray(users.id, [expiredUserId, activeUserId]));
});

describe('syncExpiredSubscriptionsToFree', () => {
  it('expires ended active plans and creates unlimited free fallback snapshots', async () => {
    const now = new Date('2026-05-10T00:00:00.000Z');
    await serverDB.insert(users).values([{ id: expiredUserId }, { id: activeUserId }]);
    await serverDB.insert(userPlanSnapshots).values([
      {
        cycle: 'monthly',
        endsAt: new Date('2026-05-01T00:00:00.000Z'),
        monthlyCredits: 1000,
        monthlyPrice: 68,
        plan: Plans.Starter,
        provider: 'admin_manual',
        startedAt: new Date('2026-04-01T00:00:00.000Z'),
        status: 'active',
        userId: expiredUserId,
      },
      {
        cycle: 'monthly',
        endsAt: new Date('2026-06-01T00:00:00.000Z'),
        monthlyCredits: 1000,
        monthlyPrice: 68,
        plan: Plans.Starter,
        provider: 'admin_manual',
        startedAt: new Date('2026-05-01T00:00:00.000Z'),
        status: 'active',
        userId: activeUserId,
      },
    ]);

    await expect(syncExpiredSubscriptionsToFree(serverDB, now)).resolves.toEqual({
      expiredSnapshots: 1,
      freeSnapshotsCreated: 1,
    });

    const expiredUserSnapshots = await serverDB.query.userPlanSnapshots.findMany({
      orderBy: userPlanSnapshots.createdAt,
      where: eq(userPlanSnapshots.userId, expiredUserId),
    });
    const activeUserSnapshots = await serverDB.query.userPlanSnapshots.findMany({
      where: eq(userPlanSnapshots.userId, activeUserId),
    });

    expect(expiredUserSnapshots.map((snapshot) => snapshot.status)).toEqual(['expired', 'active']);
    expect(expiredUserSnapshots.at(-1)).toMatchObject({
      endsAt: null,
      plan: Plans.Free,
      provider: 'system_default',
      status: 'active',
    });
    expect(activeUserSnapshots).toHaveLength(1);
    expect(activeUserSnapshots[0]).toMatchObject({
      plan: Plans.Starter,
      status: 'active',
    });
  });
});
