import { describe, expect, it, vi } from 'vitest';

import { assertStorageQuota, assertVectorQuota } from './resourceQuota';

describe('resource quota guards', () => {
  it('rejects a file when actual size would exceed the storage quota', async () => {
    const findFirst = vi.fn().mockResolvedValue({ storageQuota: 1000, vectorQuota: null });
    const db = { query: { creditAccounts: { findFirst } } };

    await expect(
      assertStorageQuota({
        currentUsage: 700,
        db: db as any,
        incomingBytes: 301,
        userId: 'user-1',
      }),
    ).rejects.toThrow('StorageQuotaExceeded');
  });

  it('allows storage when quota is empty because empty means unlimited', async () => {
    const findFirst = vi.fn().mockResolvedValue({ storageQuota: null, vectorQuota: null });
    const db = { query: { creditAccounts: { findFirst } } };

    await expect(
      assertStorageQuota({
        currentUsage: 10_000,
        db: db as any,
        incomingBytes: 10_000,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects embedding writes when the new vectors would exceed the vector quota', async () => {
    const findFirst = vi.fn().mockResolvedValue({ storageQuota: null, vectorQuota: 10 });
    const db = { query: { creditAccounts: { findFirst } } };

    await expect(
      assertVectorQuota({
        currentUsage: 8,
        db: db as any,
        incomingItems: 3,
        userId: 'user-1',
      }),
    ).rejects.toThrow('VectorQuotaExceeded');
  });

  it('marks quota rejections with a stable business error type', async () => {
    const findFirst = vi.fn().mockResolvedValue({ storageQuota: 100, vectorQuota: null });
    const db = { query: { creditAccounts: { findFirst } } };

    await expect(
      assertStorageQuota({
        currentUsage: 100,
        db: db as any,
        incomingBytes: 1,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      errorType: 'StorageQuotaExceeded',
      name: 'StorageQuotaExceeded',
    });
  });
});
