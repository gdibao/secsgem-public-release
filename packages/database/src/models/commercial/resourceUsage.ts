import type { CommercialResourceUsage } from '@lobechat/types';

type ResourceQuotaAccount = {
  storageQuota?: null | number | string;
  vectorQuota?: null | number | string;
};

const normalizeQuota = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;

  const quota = Number(value);
  return Number.isFinite(quota) && quota >= 0 ? Math.floor(quota) : null;
};

const normalizeUsage = (value: unknown) => {
  const usage = Number(value);
  return Number.isFinite(usage) && usage > 0 ? Math.floor(usage) : 0;
};

export const buildCommercialResourceUsage = (
  account: ResourceQuotaAccount | null | undefined,
  usage: { storageUsed: number; vectorUsed: number },
): CommercialResourceUsage => ({
  storage: {
    quota: normalizeQuota(account?.storageQuota),
    used: normalizeUsage(usage.storageUsed),
  },
  vector: {
    quota: normalizeQuota(account?.vectorQuota),
    used: normalizeUsage(usage.vectorUsed),
  },
});
