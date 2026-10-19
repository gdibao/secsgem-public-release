import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ADMIN_COMMANDS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { FileModel } from '@/database/models/file';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';

import { recordAdminAudit, runRequiredAdminAuditExternalEffect } from './audit';
import { adminContentRouter } from './content';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    REMOVE_GLOBAL_FILE: true,
  },
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('./audit', () => ({
  recordAdminAudit: vi.fn(),
  runRequiredAdminAuditMutation: vi.fn(async (ctx, options) => {
    const result = await ctx.serverDB.transaction((tx: unknown) => options.mutation(tx));
    await recordAdminAudit(ctx, await options.audit(result));
    return result;
  }),
  runRequiredAdminAuditExternalEffect: vi.fn(async (ctx, options) => {
    await recordAdminAudit(ctx, await options.audit('started'));
    const result = await options.effect();
    await recordAdminAudit(ctx, await options.audit('succeeded', result));
    return result;
  }),
}));

const createDb = ({
  document,
  file,
  topic,
}: {
  document?: Record<string, unknown>;
  file?: Record<string, unknown>;
  topic?: Record<string, unknown>;
} = {}) => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));

  const db = {
    __mocks: {
      delete: deleteMock,
      deleteWhere,
    },
    delete: deleteMock,
    query: {
      documents: {
        findFirst: vi.fn().mockResolvedValue(document ?? null),
      },
      files: {
        findFirst: vi.fn().mockResolvedValue(file ?? null),
      },
      topics: {
        findFirst: vi.fn().mockResolvedValue(topic ?? null),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue({ banned: false, role: 'admin' }),
      },
    },
  } as any;
  db.transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db));

  return db;
};

describe('admin content router', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects a direct delete without a command envelope before any document model call', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DocumentService).mockImplementation(function MockDocumentService() {
      return { deleteDocument } as any;
    });

    const db = createDb({
      document: {
        id: 'doc-1',
        sourceType: 'api',
        title: 'Document',
        userId: 'user-2',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(caller.deleteDocument({ documentId: 'doc-1' } as any)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REQUIRED',
    });
    expect(DocumentService).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('rejects a null command deterministically before any document model call', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DocumentService).mockImplementation(function MockDocumentService() {
      return { deleteDocument } as any;
    });

    const db = createDb({
      document: {
        id: 'doc-1',
        sourceType: 'api',
        title: 'Document',
        userId: 'user-2',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(
      caller.deleteDocument({ command: null, documentId: 'doc-1' } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ADMIN_COMMAND_REQUIRED',
    });
    expect(DocumentService).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('rejects a command for another action before any document model call', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DocumentService).mockImplementation(function MockDocumentService() {
      return { deleteDocument } as any;
    });

    const db = createDb({
      document: {
        id: 'doc-1',
        sourceType: 'api',
        title: 'Document',
        userId: 'user-2',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);

    await expect(
      caller.deleteDocument({
        command: { actionId: 'content.deleteFile', confirmed: true },
        documentId: 'doc-1',
      } as any),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(DocumentService).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('deletes files through FileModel and S3 cleanup instead of direct row deletion', async () => {
    const fileDelete = vi.fn().mockResolvedValue({ url: 'uploads/file.pdf' });
    const storageDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileModel).mockImplementation(function MockFileModel() {
      return { delete: fileDelete } as any;
    });
    vi.mocked(FileService).mockImplementation(function MockFileService() {
      return { deleteFile: storageDelete } as any;
    });

    const db = createDb({
      file: {
        fileType: 'application/pdf',
        id: 'file-1',
        name: 'file.pdf',
        size: 128,
        userId: 'user-1',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.deleteFile({
      command: { actionId: 'content.deleteFile', confirmed: true },
      fileId: 'file-1',
    });

    expect(FileModel).toHaveBeenCalledWith(db, 'user-1', undefined);
    expect(fileDelete).toHaveBeenCalledWith('file-1', {
      removeGlobalFile: expect.any(Boolean),
    });
    expect(FileService).toHaveBeenCalledWith(db, 'user-1', undefined);
    expect(storageDelete).toHaveBeenCalledWith('uploads/file.pdf');
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['content.deleteFile'].auditAction,
        resourceId: 'file-1',
        targetUserId: 'user-1',
      }),
    );
  });

  it('deletes agent-share visitor files through their provenance access scope', async () => {
    const fileDelete = vi.fn().mockResolvedValue({ url: 'uploads/visitor.pdf' });
    const storageDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileModel).mockImplementation(function MockFileModel() {
      return { delete: fileDelete } as any;
    });
    vi.mocked(FileService).mockImplementation(function MockFileService() {
      return { deleteFile: storageDelete } as any;
    });

    const db = createDb({
      file: {
        fileType: 'application/pdf',
        id: 'visitor-file-1',
        metadata: { agentShare: { shareId: 'share-1', visitorUserId: 'visitor-1' } },
        name: 'visitor.pdf',
        size: 128,
        userId: 'owner-1',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.deleteFile({
      command: { actionId: 'content.deleteFile', confirmed: true },
      fileId: 'visitor-file-1',
    });

    expect(FileModel).toHaveBeenCalledWith(db, 'owner-1', undefined);
    expect(fileDelete).toHaveBeenCalledWith('visitor-file-1', {
      accessScope: { shareId: 'share-1', type: 'agentShare', visitorUserId: 'visitor-1' },
      removeGlobalFile: expect.any(Boolean),
    });
    expect(FileService).toHaveBeenCalledWith(db, 'owner-1', undefined);
    expect(storageDelete).toHaveBeenCalledWith('uploads/visitor.pdf');
  });

  it('deletes documents through DocumentService so associated files and children are handled', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DocumentService).mockImplementation(function MockDocumentService() {
      return { deleteDocument } as any;
    });

    const db = createDb({
      document: {
        id: 'doc-1',
        sourceType: 'api',
        title: 'Document',
        userId: 'user-2',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.deleteDocument({
      command: { actionId: 'content.deleteDocument', confirmed: true },
      documentId: 'doc-1',
    });

    expect(DocumentService).toHaveBeenCalledWith(db, 'user-2');
    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['content.deleteDocument'].auditAction,
        resourceId: 'doc-1',
        targetUserId: 'user-2',
      }),
    );
    expect(runRequiredAdminAuditExternalEffect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        audit: expect.any(Function),
        effect: expect.any(Function),
      }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('deletes topics through the topics table so database cascade removes child rows', async () => {
    const db = createDb({
      topic: {
        id: 'topic-1',
        title: 'Topic',
        userId: 'user-3',
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db);

    const caller = adminContentRouter.createCaller({ userId: 'admin-user' } as any);
    await caller.deleteTopic({
      command: { actionId: 'content.deleteTopic', confirmed: true },
      topicId: 'topic-1',
    });

    expect(db.__mocks.delete).toHaveBeenCalledTimes(1);
    expect(db.__mocks.deleteWhere).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: ADMIN_COMMANDS['content.deleteTopic'].auditAction,
        resourceId: 'topic-1',
        targetUserId: 'user-3',
      }),
    );
  });

  it('does not select document body content for admin list rows', () => {
    const source = readFileSync(path.join(__dirname, 'content.ts'), 'utf8');

    expect(source).not.toContain('content: documents.content');
  });
});
