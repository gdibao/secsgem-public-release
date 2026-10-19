import { randomUUID } from 'node:crypto';

import type { ModuleAppScopeType } from '@lobechat/types';

import type { ModuleAppRunnerArtifactRequest } from './runners/apiActionRunner';
import { sanitizeModuleAppArtifactFileName } from './runtimeTemplate';

export interface ModuleAppArtifactStorage {
  uploadBuffer: (
    key: string,
    buffer: Buffer,
    contentType: string,
  ) => Promise<{ key?: string } | void>;
}

export interface ModuleAppArtifactRepository {
  createArtifact: (input: {
    appId: string;
    expiresAt?: Date | null;
    fileName: string;
    mimeType: string;
    recordId?: null | string;
    runId: string;
    scopeType: ModuleAppScopeType;
    sizeBytes: number;
    storageKey: string;
    userId: string;
    workspaceId?: string;
  }) => Promise<{ id: string }>;
}

export interface WriteModuleAppArtifactInput {
  appId: string;
  artifact: ModuleAppRunnerArtifactRequest;
  model: ModuleAppArtifactRepository;
  recordId?: string;
  runId: string;
  scopeType: ModuleAppScopeType;
  storage: ModuleAppArtifactStorage;
  userId: string;
  workspaceId?: string;
}

export const writeModuleAppArtifact = async ({
  appId,
  artifact,
  model,
  recordId,
  runId,
  scopeType,
  storage,
  userId,
  workspaceId,
}: WriteModuleAppArtifactInput): Promise<{ id: string; storageKey: string }> => {
  const fileName = sanitizeModuleAppArtifactFileName(artifact.fileName);
  const buffer = Buffer.isBuffer(artifact.content)
    ? artifact.content
    : Buffer.from(artifact.content, 'utf8');
  const storagePath = `module-apps/${appId}/${runId}/${randomUUID()}-${fileName}`;
  const uploaded = await storage.uploadBuffer(storagePath, buffer, artifact.mimeType);
  const storageKey = uploaded?.key ?? storagePath;
  const row = await model.createArtifact({
    appId,
    expiresAt: artifact.expiresAt ?? null,
    fileName,
    mimeType: artifact.mimeType,
    recordId: recordId ?? null,
    runId,
    scopeType,
    sizeBytes: buffer.length,
    storageKey,
    userId,
    workspaceId,
  });

  return { id: row.id, storageKey };
};
