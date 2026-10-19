import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { recentService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    recent: {
      getAll: { query: vi.fn() },
      getMobileWorkspace: { query: vi.fn() },
    },
  },
}));

describe('recentService.getAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lambdaClient.recent.getAll.query).mockResolvedValue([]);
    vi.mocked(lambdaClient.recent.getMobileWorkspace.query).mockResolvedValue({
      items: [],
      nextCursor: undefined,
    });
  });

  it('preserves the legacy numeric limit call', async () => {
    await recentService.getAll(12);
    expect(lambdaClient.recent.getAll.query).toHaveBeenCalledWith({ limit: 12 });
  });

  it('passes typed recent filters to the router', async () => {
    await recentService.getAll({ limit: 30, types: ['topic'] });
    expect(lambdaClient.recent.getAll.query).toHaveBeenCalledWith({
      limit: 30,
      types: ['topic'],
    });
  });

  it('requests a bounded server-owned mobile page without parent ids', async () => {
    await recentService.getMobileWorkspace({ cursor: 'next', limit: 20, query: 'design' });

    expect(lambdaClient.recent.getMobileWorkspace.query).toHaveBeenCalledWith({
      cursor: 'next',
      limit: 20,
      query: 'design',
    });
  });
});
