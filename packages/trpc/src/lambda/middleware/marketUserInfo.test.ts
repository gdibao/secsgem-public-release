import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import { marketPublicUserInfo, marketUserInfo } from './marketUserInfo';

const { mockFindById, mockGetUserSettings } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockGetUserSettings: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    vi.fn().mockImplementation(() => ({
      getUserSettings: mockGetUserSettings,
    })),
    {
      findById: mockFindById,
    },
  ),
}));

const privateRouter = trpc.router({
  ctx: trpc.procedure.use(marketUserInfo).query(({ ctx }) => ({
    marketAccessToken: ctx.marketAccessToken,
    marketUserInfo: ctx.marketUserInfo,
  })),
});

const publicRouter = trpc.router({
  ctx: trpc.procedure.use(marketPublicUserInfo).query(({ ctx }) => ({
    marketAccessToken: ctx.marketAccessToken,
    marketUserInfo: ctx.marketUserInfo,
  })),
});

const createPrivateCaller = createCallerFactory(privateRouter);
const createPublicCaller = createCallerFactory(publicRouter);

describe('marketUserInfo middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the persisted market token for user-scoped market operations', async () => {
    mockFindById.mockResolvedValue({
      email: 'user@example.com',
      fullName: 'User Name',
      username: 'user',
    });
    mockGetUserSettings.mockResolvedValue({
      market: { accessToken: 'db-market-token' },
    });

    const caller = createPrivateCaller({
      marketAccessToken: 'm2m-cookie-token',
      serverDB: {},
      userId: 'user-1',
    } as any);

    await expect(caller.ctx()).resolves.toMatchObject({
      marketAccessToken: 'db-market-token',
      marketUserInfo: {
        email: 'user@example.com',
        name: 'User Name',
        userId: 'user-1',
      },
    });
  });

  it('keeps the request market token for public discovery operations', async () => {
    mockFindById.mockResolvedValue({
      email: 'user@example.com',
      fullName: 'User Name',
      username: 'user',
    });
    mockGetUserSettings.mockResolvedValue({
      market: { accessToken: 'expired-db-market-token' },
    });

    const caller = createPublicCaller({
      marketAccessToken: 'fresh-m2m-cookie-token',
      serverDB: {},
      userId: 'user-1',
    } as any);

    await expect(caller.ctx()).resolves.toMatchObject({
      marketAccessToken: 'fresh-m2m-cookie-token',
      marketUserInfo: {
        email: 'user@example.com',
        name: 'User Name',
        userId: 'user-1',
      },
    });
    expect(mockGetUserSettings).not.toHaveBeenCalled();
  });
});
