import { trpc } from '@/libs/trpc/lambda/init';

import { assertStorageQuota } from '../resourceQuota';

export const checkFileStorageUsage = trpc.middleware(async (opts) => {
  const userId = opts.ctx.userId;

  if (!userId) {
    return opts.next();
  }

  const db = (opts.ctx as any).serverDB;
  if (!db) {
    return opts.next();
  }

  await assertStorageQuota({
    currentUsage: 0,
    db,
    incomingBytes: 0,
    userId,
  });

  return opts.next();
});
