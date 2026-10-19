import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicMetadata, RecentItem } from '@lobechat/types';
import { z } from 'zod';

export type { RecentItem } from '@lobechat/types';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  type MobileWorkspaceRecentDbItem,
  type MobileWorkspaceRecentQuery,
  type RecentDbItem,
  RecentModel,
} from '@/database/models/recent';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export interface MobileWorkspaceRecentItem {
  avatar?: MobileWorkspaceRecentDbItem['avatar'];
  backgroundColor?: string | null;
  id: string;
  kind: 'agent' | 'group';
  pinned: boolean;
  routePath: string;
  sessionId: string;
  title: string;
  topicTitle?: string;
  unreadCount: number;
  updatedAt: Date;
}

export interface MobileWorkspaceRecentResponse {
  items: MobileWorkspaceRecentItem[];
  nextCursor?: string;
}

const recentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      recentModel: new RecentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

const toRecentItem = (item: RecentDbItem): RecentItem => {
  let routePath: string;

  switch (item.type) {
    case 'topic': {
      if (item.routeGroupId) {
        routePath = GROUP_CHAT_TOPIC_URL(item.routeGroupId, item.id);
      } else if (item.routeId) {
        routePath = AGENT_CHAT_TOPIC_URL(item.routeId, item.id);
      } else {
        routePath = '/';
      }
      break;
    }
    case 'document': {
      routePath = `/page/${item.id}`;
      break;
    }
    case 'task': {
      routePath = item.routeId ? `/agent/${item.routeId}/task/${item.id}` : `/task/${item.id}`;
      break;
    }
  }

  return {
    agentId: item.routeId,
    description: item.description,
    icon: item.type,
    id: item.id,
    lastAssistantMessage: item.lastAssistantMessage,
    metadata: item.metadata as ChatTopicMetadata | undefined,
    routePath,
    slugTitle: item.slugTitle,
    status: item.status,
    title: item.title,
    type: item.type,
    updatedAt: item.updatedAt,
    userId: item.userId,
  };
};

const toMobileWorkspaceRecentItem = (
  item: MobileWorkspaceRecentDbItem,
): MobileWorkspaceRecentItem => {
  const rootRoute = item.kind === 'group' ? `/group/${item.id}` : `/agent/${item.id}`;
  const topicRoute = item.topic ? toRecentItem(item.topic).routePath : rootRoute;

  return {
    avatar: item.avatar,
    backgroundColor: item.backgroundColor,
    id: item.id,
    kind: item.kind,
    pinned: item.pinned,
    routePath: item.pinned ? rootRoute : topicRoute,
    sessionId: item.id,
    title: item.title,
    topicTitle: item.topic?.title.trim() || undefined,
    unreadCount: item.unreadCount,
    updatedAt: item.topic?.updatedAt ?? item.updatedAt,
  };
};

export const recentRouter = router({
  getAll: recentProcedure
    .input(
      z
        .object({
          limit: z.number().optional(),
          /** Restrict a workspace feed to the viewer's own items (mine/team toggle). */
          mineOnly: z.boolean().optional(),
          /** Restrict the workspace feed to conversations visible to the whole team. */
          sharedOnly: z.boolean().optional(),
          types: z.array(z.enum(['topic', 'document', 'task'])).optional(),
          withTopicPreview: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RecentItem[]> => {
      const limit = input?.limit ?? 10;

      const items = await ctx.recentModel.queryRecent(
        limit,
        input?.types,
        input?.withTopicPreview,
        input?.mineOnly,
        input?.sharedOnly,
      );
      return items.map(toRecentItem);
    }),
  getMobileWorkspace: recentProcedure
    .input(
      z
        .object({
          cursor: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(50).default(20),
          query: z.string().trim().max(100).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }): Promise<MobileWorkspaceRecentResponse> => {
      const result = await ctx.recentModel.queryMobileWorkspace(
        input satisfies MobileWorkspaceRecentQuery,
      );

      return {
        items: result.items.map(toMobileWorkspaceRecentItem),
        nextCursor: result.nextCursor,
      };
    }),
});

export type RecentRouter = typeof recentRouter;
