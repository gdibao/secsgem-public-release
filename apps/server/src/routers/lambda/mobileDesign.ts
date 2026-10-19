import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GenerationTopicModel } from '@/database/models/generationTopic';
import { pptUsageRecords } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';

export interface MobileRecentDesignItem {
  id: string;
  kind: 'document' | 'image' | 'ppt';
  resumeSupported?: boolean;
  routePath: string;
  status?: string;
  title: string;
  updatedAt: Date;
}

interface RecentDesignRecord {
  id: string;
  title?: null | string;
  updatedAt: Date;
}

interface RecentPptRecord extends RecentDesignRecord {
  status?: null | string;
  upstreamTaskId?: null | string;
}

interface MobileDesignSources {
  documents: (limit: number) => Promise<RecentDesignRecord[]>;
  images: (limit: number) => Promise<RecentDesignRecord[]>;
  ppts: (limit: number) => Promise<RecentPptRecord[]>;
}

const titleOr = (title: null | string | undefined, fallback: string) => title?.trim() || fallback;

export const aggregateMobileRecentDesignItems = async (
  sources: MobileDesignSources,
  limit: number,
): Promise<MobileRecentDesignItem[]> => {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const [documents, images, ppts] = await Promise.allSettled([
    sources.documents(normalizedLimit),
    sources.images(normalizedLimit),
    sources.ppts(normalizedLimit),
  ]);

  if ([documents, images, ppts].every((result) => result.status === 'rejected')) {
    throw new AggregateError(
      [documents, images, ppts].map((result) =>
        result.status === 'rejected' ? result.reason : undefined,
      ),
      'Unable to load recent design work',
    );
  }

  const items: MobileRecentDesignItem[] = [];

  if (documents.status === 'fulfilled') {
    items.push(
      ...documents.value.map((item) => ({
        id: item.id,
        kind: 'document' as const,
        routePath: `/page/${encodeURIComponent(item.id)}`,
        title: titleOr(item.title, 'Untitled document'),
        updatedAt: item.updatedAt,
      })),
    );
  }

  if (images.status === 'fulfilled') {
    items.push(
      ...images.value.map((item) => ({
        id: item.id,
        kind: 'image' as const,
        routePath: `/image?topic=${encodeURIComponent(item.id)}`,
        title: titleOr(item.title, 'Untitled image'),
        updatedAt: item.updatedAt,
      })),
    );
  }

  if (ppts.status === 'fulfilled') {
    items.push(
      ...ppts.value.map((item) => ({
        id: item.id,
        kind: 'ppt' as const,
        resumeSupported: Boolean(item.upstreamTaskId),
        routePath: item.upstreamTaskId ? `/ppt?recordId=${encodeURIComponent(item.id)}` : '/ppt',
        ...(item.status ? { status: item.status } : {}),
        title: titleOr(item.title, 'Untitled presentation'),
        updatedAt: item.updatedAt,
      })),
    );
  }

  return items
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, normalizedLimit);
};

const mobileDesignProcedure = wsCompatProcedure.use(serverDatabase);

export const mobileDesignRouter = router({
  getRecent: mobileDesignProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const workspaceId = ctx.workspaceId ?? undefined;
      const documentService = new DocumentService(ctx.serverDB, ctx.userId, workspaceId);
      const generationTopicModel = new GenerationTopicModel(ctx.serverDB, ctx.userId, workspaceId);

      return aggregateMobileRecentDesignItems(
        {
          documents: async (domainLimit) => {
            const result = await documentService.queryDocuments({
              current: 0,
              fileTypes: [CUSTOM_DOCUMENT_FILE_TYPE],
              pageSize: domainLimit,
              sourceTypes: ['editor'],
            });

            return result.items;
          },
          images: (domainLimit) => generationTopicModel.queryAll('image', { limit: domainLimit }),
          ppts: (domainLimit) =>
            ctx.serverDB
              .select({
                id: pptUsageRecords.id,
                status: pptUsageRecords.status,
                title: pptUsageRecords.title,
                updatedAt: pptUsageRecords.updatedAt,
                upstreamTaskId: pptUsageRecords.upstreamTaskId,
              })
              .from(pptUsageRecords)
              .where(
                and(
                  eq(pptUsageRecords.userId, ctx.userId),
                  inArray(pptUsageRecords.status, ['editing', 'generated', 'downloaded']),
                ),
              )
              .orderBy(desc(pptUsageRecords.updatedAt))
              .limit(domainLimit),
        },
        limit,
      );
    }),
});

export type MobileDesignRouter = typeof mobileDesignRouter;
