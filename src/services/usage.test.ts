import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usageService } from './usage';

const mocks = vi.hoisted(() => ({
  findByDateRange: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    usage: {
      findByDateRange: { query: mocks.findByDateRange },
    },
  },
}));

describe('usageService', () => {
  beforeEach(() => {
    mocks.findByDateRange.mockReset();
    mocks.findByDateRange.mockResolvedValue([]);
  });

  it('forwards an exact date range to the usage API', async () => {
    await usageService.findByDateRange('2026-06-15', '2026-07-15');

    expect(mocks.findByDateRange).toHaveBeenCalledWith({
      endAt: '2026-07-15',
      startAt: '2026-06-15',
    });
  });
});
