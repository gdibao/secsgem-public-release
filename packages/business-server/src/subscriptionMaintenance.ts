import { Plans } from '@lobechat/types';
import { and, desc, eq, lt } from 'drizzle-orm';

import { CommercialModel } from '@/database/models/commercial';
import { userPlanSnapshots } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

type SubscriptionMaintenanceDB = LobeChatDatabase | Transaction;

export const syncExpiredSubscriptionsToFree = async (
  db: SubscriptionMaintenanceDB,
  now = new Date(),
) => {
  const expired = await db
    .update(userPlanSnapshots)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(userPlanSnapshots.status, 'active'), lt(userPlanSnapshots.endsAt, now)))
    .returning({ userId: userPlanSnapshots.userId });

  const affectedUserIds = Array.from(new Set(expired.map((snapshot) => snapshot.userId)));
  let freeSnapshotsCreated = 0;

  for (const userId of affectedUserIds) {
    const activeSnapshot = await db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(eq(userPlanSnapshots.userId, userId), eq(userPlanSnapshots.status, 'active')),
    });

    if (activeSnapshot) {
      await new CommercialModel(db as LobeChatDatabase, userId).syncActivePlanResourceQuotas(db);
      continue;
    }

    const [created] = await db
      .insert(userPlanSnapshots)
      .values({
        cycle: 'monthly',
        externalSubscriptionId: `default-free-${userId}`,
        metadata: { source: 'maintenance_expiry_fallback', unlimited: true },
        monthlyCredits: 0,
        monthlyPrice: 0,
        plan: Plans.Free,
        provider: 'system_default',
        startedAt: now,
        status: 'active',
        userId,
      })
      .onConflictDoNothing()
      .returning({ id: userPlanSnapshots.id });

    if (created) freeSnapshotsCreated += 1;

    await new CommercialModel(db as LobeChatDatabase, userId).syncActivePlanResourceQuotas(db);
  }

  return {
    expiredSnapshots: expired.length,
    freeSnapshotsCreated,
  };
};
