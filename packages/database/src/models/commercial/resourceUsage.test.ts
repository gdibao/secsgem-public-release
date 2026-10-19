import { describe, expect, it } from 'vitest';

import { buildCommercialResourceUsage } from './resourceUsage';

describe('buildCommercialResourceUsage', () => {
  it('normalizes persisted quotas and reports current storage and vector usage', () => {
    expect(
      buildCommercialResourceUsage(
        { storageQuota: '15728640', vectorQuota: 100 },
        { storageUsed: 27_500_000, vectorUsed: 7 },
      ),
    ).toEqual({
      storage: { quota: 15_728_640, used: 27_500_000 },
      vector: { quota: 100, used: 7 },
    });
  });

  it('keeps unlimited quotas explicit and clamps invalid usage values', () => {
    expect(
      buildCommercialResourceUsage(
        { storageQuota: null, vectorQuota: undefined },
        { storageUsed: -1, vectorUsed: Number.NaN },
      ),
    ).toEqual({
      storage: { quota: null, used: 0 },
      vector: { quota: null, used: 0 },
    });
  });
});
