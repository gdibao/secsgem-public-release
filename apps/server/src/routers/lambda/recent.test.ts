import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recentRouter } from './recent';

const queryMobileWorkspace = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/recent', () => ({
  RecentModel: class {
    queryMobileWorkspace = queryMobileWorkspace;
  },
}));

describe('recentRouter.getMobileWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMobileWorkspace.mockResolvedValue({
      items: [
        {
          avatar: null,
          backgroundColor: null,
          id: 'agent-1',
          kind: 'agent',
          pinned: false,
          title: 'Agent 1',
          topic: {
            id: 'topic-1',
            metadata: undefined,
            routeGroupId: null,
            routeId: 'agent-1',
            status: null,
            title: 'Latest topic',
            type: 'topic',
            updatedAt: new Date('2026-07-20T08:00:00.000Z'),
          },
          unreadCount: 2,
          updatedAt: new Date('2026-07-20T08:00:00.000Z'),
        },
      ],
      nextCursor: 'next-page',
    });
  });

  it('accepts only bounded server-owned query inputs and maps topic routes', async () => {
    const caller = recentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    const result = await caller.getMobileWorkspace({ cursor: 'cursor-1', limit: 20, query: 'agent' });

    expect(queryMobileWorkspace).toHaveBeenCalledWith({
      cursor: 'cursor-1',
      limit: 20,
      query: 'agent',
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'agent-1',
          kind: 'agent',
          routePath: '/agent/agent-1/topic-1',
          topicTitle: 'Latest topic',
          unreadCount: 2,
        }),
      ],
      nextCursor: 'next-page',
    });
  });

  it('rejects legacy parent-id payloads', async () => {
    const caller = recentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await expect(
      caller.getMobileWorkspace({ agentIds: ['agent-1'], groupIds: [] } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
