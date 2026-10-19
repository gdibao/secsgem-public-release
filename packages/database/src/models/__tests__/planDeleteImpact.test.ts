import { describe, expect, it, vi } from 'vitest';

import { getPlanDeleteImpact } from '../commercial';

const createDb = (counts: number[]) => ({
  query: {
    planCatalog: {
      findFirst: vi.fn().mockResolvedValue({ displayName: 'Premium', plan: 'premium' }),
    },
  },
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ value: counts.shift() ?? 0 }]),
    })),
  })),
});

describe('getPlanDeleteImpact', () => {
  it('counts active snapshots, redemption codes, and pending plan changes as blockers', async () => {
    const impact = await getPlanDeleteImpact(createDb([3, 2, 4]) as any, 'premium');

    expect(impact.canProceed).toBe(false);
    expect(impact.blocking).toEqual([
      expect.objectContaining({ code: 'PLAN_ACTIVE_SNAPSHOTS', count: 3 }),
      expect.objectContaining({ code: 'PLAN_REDEMPTION_CODES', count: 2 }),
      expect.objectContaining({ code: 'PLAN_PENDING_CHANGE_REQUESTS', count: 4 }),
    ]);
    expect(impact.target).toEqual({ id: 'premium', label: 'Premium', type: 'plan' });
  });
});
