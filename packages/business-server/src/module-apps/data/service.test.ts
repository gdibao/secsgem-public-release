import type { ModuleAppCapabilityClaims, ModuleAppTableSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppDataService } from './service';

const INSTALLATION_ID = '00000000-0000-4000-8000-000000000001';
const schema: ModuleAppTableSchema = {
  additionalJson: false,
  fields: [
    { key: 'email', required: true, sensitive: false, type: 'string' },
    { key: 'score', required: false, sensitive: false, type: 'number' },
  ],
  indexes: [{ fields: ['email'], unique: true }],
  key: 'candidates',
};
const capability = (permissions: string[]): ModuleAppCapabilityClaims => ({
  appId: '00000000-0000-4000-8000-000000000002',
  aud: 'module-runtime',
  exp: 1_783_760_300,
  iat: 1_783_760_000,
  installationId: INSTALLATION_ID,
  nonce: '0123456789abcdef0123456789abcdef',
  permissions,
  surface: 'browser',
  userId: 'user-1',
  versionId: '00000000-0000-4000-8000-000000000003',
});

const createService = () => {
  const repository = {
    archiveRow: vi.fn().mockResolvedValue({ rowKey: 'candidate-1', status: 'archived' }),
    getActiveSchema: vi.fn().mockResolvedValue({ schemaSnapshot: schema, version: 1 }),
    getRow: vi.fn().mockResolvedValue({ rowKey: 'candidate-1', values: { email: 'one@example.com' } }),
    insertRow: vi.fn().mockResolvedValue({ rowKey: 'candidate-1', values: { email: 'one@example.com' } }),
    listRows: vi.fn().mockResolvedValue({ items: [], nextCursor: 'next-cursor' }),
    transaction: vi.fn().mockResolvedValue([]),
    updateRow: vi.fn().mockResolvedValue({ rowKey: 'candidate-1', values: { score: 95 } }),
  };
  return { repository, service: new ModuleAppDataService({ repository }) };
};

describe('ModuleAppDataService', () => {
  it('denies writes without data.write permission', async () => {
    const { service } = createService();
    await expect(
      service.insert({
        capability: capability(['data.read']),
        input: { tableKey: 'candidates', values: { email: 'one@example.com' } },
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_DENIED');
  });

  it('validates values before inserting into the installation repository', async () => {
    const { repository, service } = createService();
    await expect(
      service.insert({
        capability: capability(['data.write']),
        input: { tableKey: 'candidates', values: { email: 123 } },
      }),
    ).rejects.toThrow('MODULE_APP_DATA_SCHEMA_INVALID');
    expect(repository.insertRow).not.toHaveBeenCalled();
  });

  it('returns bounded cursor pagination for readers', async () => {
    const { repository, service } = createService();
    await expect(
      service.list({
        capability: capability(['data.read']),
        input: { limit: 20, tableKey: 'candidates' },
      }),
    ).resolves.toEqual({ items: [], nextCursor: 'next-cursor' });
    expect(repository.listRows).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: INSTALLATION_ID, limit: 20 }),
    );
  });

  it('returns a stable error for malformed SDK input', async () => {
    const { service } = createService();
    await expect(
      service.list({
        capability: capability(['data.read']),
        input: { limit: 101, tableKey: 'candidates' },
      }),
    ).rejects.toThrow('MODULE_APP_DATA_INPUT_INVALID');
  });
});
