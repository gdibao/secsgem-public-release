import type { RecentItem } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import type { MobileWorkspaceRecentResponse } from '@/server/routers/lambda/recent';

export interface RecentQueryOptions {
  limit?: number;
  mineOnly?: boolean;
  sharedOnly?: boolean;
  types?: readonly RecentItem['type'][];
  withTopicPreview?: boolean;
}

export interface MobileWorkspaceRecentQuery {
  cursor?: string;
  limit?: number;
  query?: string;
}

export const RECENT_SIDEBAR_TYPES = [
  'document',
  'task',
] as const satisfies readonly RecentItem['type'][];

class RecentService {
  getAll = (
    input?: number | RecentQueryOptions,
    types?: readonly RecentItem['type'][],
    withTopicPreview?: boolean,
    mineOnly?: boolean,
    sharedOnly?: boolean,
  ): Promise<RecentItem[]> => {
    const query =
      typeof input === 'number' || input === undefined
        ? { limit: input, mineOnly, sharedOnly, types, withTopicPreview }
        : input;
    const request = {
      ...query,
      types: query.types ? [...query.types] : undefined,
    };
    return lambdaClient.recent.getAll.query(
      Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as any,
    );
  };

  getMobileWorkspace = (
    input: MobileWorkspaceRecentQuery = {},
  ): Promise<MobileWorkspaceRecentResponse> => lambdaClient.recent.getMobileWorkspace.query(input);
}

export const recentService = new RecentService();
