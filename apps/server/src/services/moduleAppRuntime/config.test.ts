import { describe, expect, it, vi } from 'vitest';

import { getServerModuleAppRuntimeConfig } from './config';

vi.mock('@/server/services/appSettings/secrets', () => ({
  decryptAppSettingSecret: vi.fn(async (_key: string, value: unknown) => value),
}));

describe('getServerModuleAppRuntimeConfig', () => {
  it('fails closed when backend settings cannot be read', async () => {
    const dbError = new Error('app settings unavailable');
    const db = {
      query: {
        appSettings: {
          findMany: vi.fn().mockRejectedValue(dbError),
        },
      },
    } as any;

    await expect(getServerModuleAppRuntimeConfig(db)).rejects.toBe(dbError);
  });
});
