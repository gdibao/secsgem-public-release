import { eq } from 'drizzle-orm';

import { creditAccounts } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

type ResourceQuotaAccount = {
  storageQuota?: null | number | string;
  vectorQuota?: null | number | string;
};

type ResourceQuotaDB = Pick<LobeChatDatabase, 'query'>;
type ResourceQuotaErrorType = 'StorageQuotaExceeded' | 'VectorQuotaExceeded';

class ResourceQuotaError extends Error {
  errorType: ResourceQuotaErrorType;

  constructor(errorType: ResourceQuotaErrorType) {
    super(errorType);
    this.name = errorType;
    this.errorType = errorType;
  }
}

const normalizeQuota = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;

  const quota = Number(value);
  if (!Number.isFinite(quota) || quota < 0) return null;

  return Math.floor(quota);
};

const getAccount = async (
  db: ResourceQuotaDB | null | undefined,
  userId: string,
): Promise<ResourceQuotaAccount | null> => {
  if (!db?.query?.creditAccounts?.findFirst) return null;

  return (
    (await db.query.creditAccounts.findFirst({
      columns: { storageQuota: true, vectorQuota: true },
      where: eq(creditAccounts.userId, userId),
    })) ?? null
  );
};

export const assertStorageQuota = async ({
  currentUsage,
  db,
  incomingBytes,
  userId,
}: {
  currentUsage: number;
  db: ResourceQuotaDB | null | undefined;
  incomingBytes: number;
  userId: string;
}) => {
  const account = await getAccount(db, userId);
  const quota = normalizeQuota(account?.storageQuota);

  if (quota === null) return;
  if (Math.max(0, currentUsage) + Math.max(0, incomingBytes) > quota) {
    throw new ResourceQuotaError('StorageQuotaExceeded');
  }
};

export const assertVectorQuota = async ({
  currentUsage,
  db,
  incomingItems,
  userId,
}: {
  currentUsage: number;
  db: ResourceQuotaDB | null | undefined;
  incomingItems: number;
  userId: string;
}) => {
  const account = await getAccount(db, userId);
  const quota = normalizeQuota(account?.vectorQuota);

  if (quota === null) return;
  if (Math.max(0, currentUsage) + Math.max(0, incomingItems) > quota) {
    throw new ResourceQuotaError('VectorQuotaExceeded');
  }
};
