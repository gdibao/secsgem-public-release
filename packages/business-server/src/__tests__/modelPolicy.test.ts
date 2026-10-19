import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS, invalidateServerAppSettings } from '@/server/services/appSettings';

import { assertModelPolicyAllowed } from '../modelPolicy';

const createDb = (settings: Record<string, unknown>) =>
  ({
    query: {
      appSettings: {
        findMany: async () =>
          Object.entries(settings).map(([key, value]) => ({
            key,
            value,
          })),
      },
    },
  }) as any;

describe('assertModelPolicyAllowed', () => {
  beforeEach(async () => {
    await invalidateServerAppSettings();
  });

  it('skips checks when model policy is disabled', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyBlocklist]: ['newapi:*'],
      [APP_SETTING_KEYS.modelPolicyEnabled]: false,
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'gpt-4o-mini',
        provider: 'newapi',
        usageType: 'chat',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows provider wildcard entries in allowlist mode', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyAllowlist]: ['newapi:gpt-*'],
      [APP_SETTING_KEYS.modelPolicyEnabled]: true,
      [APP_SETTING_KEYS.modelPolicyMode]: 'allowlist',
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'gpt-4o-mini',
        provider: 'newapi',
        usageType: 'chat',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows provider aliases for admin-managed provider groups', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyAllowlist]: ['newapi:gpt-*'],
      [APP_SETTING_KEYS.modelPolicyEnabled]: true,
      [APP_SETTING_KEYS.modelPolicyMode]: 'allowlist',
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'gpt-4o-mini',
        provider: 'siliconflow-id',
        providerAliases: ['newapi'],
        usageType: 'chat',
      } as any),
    ).resolves.toBeUndefined();
  });

  it('rejects matched blocklist entries with a runtime error payload', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyBlocklist]: ['newapi:legacy-*'],
      [APP_SETTING_KEYS.modelPolicyDeniedMessage]: '模型已禁用',
      [APP_SETTING_KEYS.modelPolicyEnabled]: true,
      [APP_SETTING_KEYS.modelPolicyMode]: 'blocklist',
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'legacy-chat',
        provider: 'newapi',
        usageType: 'chat',
      }),
    ).rejects.toMatchObject({
      error: {
        message: '模型已禁用',
        reason: 'MODEL_POLICY_DENIED',
      },
      errorType: ChatErrorType.Forbidden,
    });
  });

  it('can skip embeddings according to scope settings', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyApplyToEmbeddings]: false,
      [APP_SETTING_KEYS.modelPolicyBlocklist]: ['newapi:*'],
      [APP_SETTING_KEYS.modelPolicyEnabled]: true,
      [APP_SETTING_KEYS.modelPolicyMode]: 'blocklist',
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'text-embedding-3-small',
        provider: 'newapi',
        usageType: 'embeddings',
      }),
    ).resolves.toBeUndefined();
  });

  it('applies global model policy to image generation models', async () => {
    const db = createDb({
      [APP_SETTING_KEYS.modelPolicyBlocklist]: ['newapi:blocked-image'],
      [APP_SETTING_KEYS.modelPolicyDeniedMessage]: '图像模型已禁用',
      [APP_SETTING_KEYS.modelPolicyEnabled]: true,
      [APP_SETTING_KEYS.modelPolicyMode]: 'blocklist',
    });

    await expect(
      assertModelPolicyAllowed({
        db,
        model: 'blocked-image',
        provider: 'newapi',
        usageType: 'image',
      }),
    ).rejects.toMatchObject({
      error: {
        message: '图像模型已禁用',
        reason: 'MODEL_POLICY_DENIED',
        usageType: 'image',
      },
      errorType: ChatErrorType.Forbidden,
    });
  });
});
