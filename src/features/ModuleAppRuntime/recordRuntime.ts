import type { ModuleAppScopeType } from '@lobechat/types';

export interface ModuleAppRecordData {
  data: Record<string, unknown>;
  id: string;
  status?: string;
  title?: null | string;
  updatedAt?: Date | string;
}

export interface ModuleAppRecordPage {
  items: ModuleAppRecordData[];
  total: number;
}

export const getModuleAppRecordListKey = (input: {
  appId: string;
  collectionKey: string;
  limit?: number;
  offset?: number;
  scopeType: ModuleAppScopeType;
  workspaceId?: string;
}) => [
  'moduleApp.listRecords',
  input.appId,
  input.collectionKey,
  input.scopeType,
  input.workspaceId ?? null,
  input.limit ?? null,
  input.offset ?? null,
] as const;

export const isModuleAppRecordListKey = (
  key: unknown,
  input: {
    appId: string;
    collectionKey: string;
    scopeType: ModuleAppScopeType;
    workspaceId?: string;
  },
) =>
  Array.isArray(key) &&
  key[0] === 'moduleApp.listRecords' &&
  key[1] === input.appId &&
  key[2] === input.collectionKey &&
  key[3] === input.scopeType &&
  key[4] === (input.workspaceId ?? null);
