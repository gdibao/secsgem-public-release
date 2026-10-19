import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { mobileDesignService } from './mobileDesign';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    mobileDesign: {
      getRecent: { query: vi.fn() },
    },
  },
}));

describe('mobileDesignService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lambdaClient.mobileDesign.getRecent.query).mockResolvedValue([]);
  });

  it('requests a bounded recent design list', async () => {
    await mobileDesignService.getRecent(18);

    expect(lambdaClient.mobileDesign.getRecent.query).toHaveBeenCalledWith({ limit: 18 });
  });
});
