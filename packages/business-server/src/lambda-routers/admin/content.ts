import { agentShareFileAccessScope, getAgentShareFileProvenance } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { documents, files, topics, users } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';

import { createAdminCommand } from './adminCommand';
import { runRequiredAdminAuditExternalEffect, runRequiredAdminAuditMutation } from './audit';

const pageInput = z.object({
  cursor: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  query: z.string().trim().optional(),
  userId: z.string().trim().optional(),
});

const escapeLike = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&');

const buildUserSearchWhere = (query?: string) =>
  query
    ? or(
        like(users.email, `%${escapeLike(query)}%`),
        like(users.username, `%${escapeLike(query)}%`),
        like(users.fullName, `%${escapeLike(query)}%`),
      )
    : undefined;

const getTopicForAction = async (ctx: any, topicId: string) => {
  const topic = await ctx.serverDB.query.topics.findFirst({ where: eq(topics.id, topicId) });

  if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'TOPIC_NOT_FOUND' });

  return topic;
};

const getFileForAction = async (ctx: any, fileId: string) => {
  const file = await ctx.serverDB.query.files.findFirst({ where: eq(files.id, fileId) });

  if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'FILE_NOT_FOUND' });

  return file;
};

const getDocumentForAction = async (ctx: any, documentId: string) => {
  const document = await ctx.serverDB.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });

  if (!document) throw new TRPCError({ code: 'NOT_FOUND', message: 'DOCUMENT_NOT_FOUND' });

  return document;
};

const contentReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.contentRead);
const contentWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.contentWrite);
const deleteDocumentCommand = createAdminCommand('content.deleteDocument');
const deleteFileCommand = createAdminCommand('content.deleteFile');
const deleteTopicCommand = createAdminCommand('content.deleteTopic');

export const adminContentRouter = router({
  archiveTopic: contentWriteProcedure
    .input(z.object({ topicId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const topic = await getTopicForAction(ctx, input.topicId);

      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: 'content.topic.archive',
          payload: { title: topic.title },
          resourceId: input.topicId,
          resourceType: 'topic',
          targetUserId: topic.userId,
        }),
        mutation: async (tx) => {
          await tx
            .update(topics)
            .set({ status: 'archived', updatedAt: new Date() })
            .where(eq(topics.id, input.topicId));
        },
      });

      return { ok: true };
    }),

  deleteDocument: contentWriteProcedure
    .input(z.object({ command: deleteDocumentCommand.schema, documentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const command = deleteDocumentCommand.validate(input.command);
      const document = await getDocumentForAction(ctx, input.documentId);
      await runRequiredAdminAuditExternalEffect(ctx, {
        audit: () => ({
          action: command.auditAction,
          payload: { sourceType: document.sourceType, title: document.title },
          resourceId: input.documentId,
          resourceType: 'document',
          targetUserId: document.userId,
        }),
        effect: async () => {
          const documentService = new DocumentService(ctx.serverDB, document.userId);
          await documentService.deleteDocument(input.documentId);
        },
      });

      return { ok: true };
    }),

  deleteFile: contentWriteProcedure
    .input(z.object({ command: deleteFileCommand.schema, fileId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const command = deleteFileCommand.validate(input.command);
      const file = await getFileForAction(ctx, input.fileId);
      await runRequiredAdminAuditExternalEffect(ctx, {
        audit: () => ({
          action: command.auditAction,
          payload: { fileType: file.fileType, name: file.name, size: file.size },
          resourceId: input.fileId,
          resourceType: 'file',
          targetUserId: file.userId,
        }),
        effect: async () => {
          const provenance = getAgentShareFileProvenance(file.metadata);
          const workspaceId = file.workspaceId ?? undefined;
          const fileModel = new FileModel(ctx.serverDB, file.userId, workspaceId);
          const fileService = new FileService(ctx.serverDB, file.userId, workspaceId);
          const removedFile = await fileModel.delete(input.fileId, {
            ...(provenance ? { accessScope: agentShareFileAccessScope(provenance) } : {}),
            removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
          });

          if (removedFile?.url) {
            await fileService.deleteFile(removedFile.url);
          }
        },
      });

      return { ok: true };
    }),

  deleteTopic: contentWriteProcedure
    .input(z.object({ command: deleteTopicCommand.schema, topicId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const command = deleteTopicCommand.validate(input.command);
      const topic = await getTopicForAction(ctx, input.topicId);

      await runRequiredAdminAuditMutation(ctx, {
        audit: () => ({
          action: command.auditAction,
          payload: { title: topic.title },
          resourceId: input.topicId,
          resourceType: 'topic',
          targetUserId: topic.userId,
        }),
        mutation: async (tx) => {
          await tx.delete(topics).where(eq(topics.id, input.topicId));
        },
      });

      return { ok: true };
    }),

  listDocuments: contentReadProcedure
    .input(
      pageInput.extend({
        sourceType: z.enum(['file', 'web', 'api', 'topic', 'agent', 'agent-signal']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const searchWhere = input.query
        ? or(
            like(documents.title, `%${escapeLike(input.query)}%`),
            like(documents.filename, `%${escapeLike(input.query)}%`),
            like(documents.source, `%${escapeLike(input.query)}%`),
            buildUserSearchWhere(input.query),
          )
        : undefined;
      const where = and(
        searchWhere,
        input.userId ? eq(documents.userId, input.userId) : undefined,
        input.sourceType ? eq(documents.sourceType, input.sourceType) : undefined,
      );

      const [rows, totalRow] = await Promise.all([
        ctx.serverDB
          .select({
            document: {
              createdAt: documents.createdAt,
              fileType: documents.fileType,
              filename: documents.filename,
              id: documents.id,
              source: documents.source,
              sourceType: documents.sourceType,
              title: documents.title,
              totalCharCount: documents.totalCharCount,
              updatedAt: documents.updatedAt,
              userId: documents.userId,
            },
            user: {
              email: users.email,
              fullName: users.fullName,
              id: users.id,
              username: users.username,
            },
          })
          .from(documents)
          .leftJoin(users, eq(documents.userId, users.id))
          .where(where)
          .orderBy(desc(documents.updatedAt), desc(documents.createdAt))
          .limit(input.limit)
          .offset(input.cursor),
        ctx.serverDB
          .select({ value: count() })
          .from(documents)
          .leftJoin(users, eq(documents.userId, users.id))
          .where(where),
      ]);

      return {
        items: rows,
        nextCursor: rows.length === input.limit ? input.cursor + input.limit : null,
        total: totalRow[0]?.value ?? 0,
      };
    }),

  listFiles: contentReadProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const searchWhere = input.query
      ? or(
          like(files.name, `%${escapeLike(input.query)}%`),
          like(files.fileType, `%${escapeLike(input.query)}%`),
          like(files.url, `%${escapeLike(input.query)}%`),
          buildUserSearchWhere(input.query),
        )
      : undefined;
    const where = and(searchWhere, input.userId ? eq(files.userId, input.userId) : undefined);

    const [rows, totalRow] = await Promise.all([
      ctx.serverDB
        .select({
          file: {
            createdAt: files.createdAt,
            embeddingTaskId: files.embeddingTaskId,
            fileHash: files.fileHash,
            fileType: files.fileType,
            id: files.id,
            name: files.name,
            size: files.size,
            updatedAt: files.updatedAt,
            url: files.url,
            userId: files.userId,
          },
          user: {
            email: users.email,
            fullName: users.fullName,
            id: users.id,
            username: users.username,
          },
        })
        .from(files)
        .leftJoin(users, eq(files.userId, users.id))
        .where(where)
        .orderBy(desc(files.updatedAt), desc(files.createdAt))
        .limit(input.limit)
        .offset(input.cursor),
      ctx.serverDB
        .select({ value: count() })
        .from(files)
        .leftJoin(users, eq(files.userId, users.id))
        .where(where),
    ]);

    return {
      items: rows,
      nextCursor: rows.length === input.limit ? input.cursor + input.limit : null,
      total: totalRow[0]?.value ?? 0,
    };
  }),

  listTopics: contentReadProcedure
    .input(
      pageInput.extend({
        status: z.enum(['active', 'completed', 'archived']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const searchWhere = input.query
        ? or(
            like(topics.title, `%${escapeLike(input.query)}%`),
            like(topics.description, `%${escapeLike(input.query)}%`),
            like(topics.content, `%${escapeLike(input.query)}%`),
            buildUserSearchWhere(input.query),
          )
        : undefined;
      const where = and(
        searchWhere,
        input.userId ? eq(topics.userId, input.userId) : undefined,
        input.status ? eq(topics.status, input.status) : undefined,
      );

      const [rows, totalRow] = await Promise.all([
        ctx.serverDB
          .select({
            topic: {
              agentId: topics.agentId,
              completedAt: topics.completedAt,
              createdAt: topics.createdAt,
              description: topics.description,
              favorite: topics.favorite,
              id: topics.id,
              mode: topics.mode,
              sessionId: topics.sessionId,
              status: topics.status,
              title: topics.title,
              trigger: topics.trigger,
              updatedAt: topics.updatedAt,
              userId: topics.userId,
            },
            user: {
              email: users.email,
              fullName: users.fullName,
              id: users.id,
              username: users.username,
            },
          })
          .from(topics)
          .leftJoin(users, eq(topics.userId, users.id))
          .where(where)
          .orderBy(desc(topics.updatedAt), desc(topics.createdAt))
          .limit(input.limit)
          .offset(input.cursor),
        ctx.serverDB
          .select({ value: count() })
          .from(topics)
          .leftJoin(users, eq(topics.userId, users.id))
          .where(where),
      ]);

      return {
        items: rows,
        nextCursor: rows.length === input.limit ? input.cursor + input.limit : null,
        total: totalRow[0]?.value ?? 0,
      };
    }),
});
