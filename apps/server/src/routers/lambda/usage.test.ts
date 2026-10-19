import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usageRouter } from './usage';

const mocks = vi.hoisted(() => ({
  findByDateRange: vi.fn(),
}));

vi.mock('@/server/services/usage', () => ({
  UsageRecordService: class {
    findByDateRange = mocks.findByDateRange;
  },
}));

const createCaller = () => usageRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

describe('usageRouter.findByDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDateRange.mockResolvedValue([]);
  });

  it.each([
    { endAt: '2026-07-15', startAt: 'not-a-date' },
    { endAt: '2026-02-30', startAt: '2026-02-01' },
    { endAt: '2026-06-15', startAt: '2026-07-15' },
    { endAt: '2026-01-03', startAt: '2025-01-01' },
  ])('rejects invalid or unsafe date range %#', async (input) => {
    await expect(createCaller().findByDateRange(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.findByDateRange).not.toHaveBeenCalled();
  });

  it('accepts a bounded ISO date range', async () => {
    await expect(
      createCaller().findByDateRange({ endAt: '2026-07-15', startAt: '2026-06-15' }),
    ).resolves.toEqual([]);

    expect(mocks.findByDateRange).toHaveBeenCalledWith('2026-06-15', '2026-07-15', undefined);
  });
});
