import { generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { signModuleAppCapability, verifyModuleAppCapability } from './capability';

const NOW = new Date('2026-07-11T08:00:00.000Z');
const APP_ID = '00000000-0000-4000-8000-000000000001';
const VERSION_ID = '00000000-0000-4000-8000-000000000002';
const INSTALLATION_ID = '00000000-0000-4000-8000-000000000003';

const createKeys = async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { kid: 'module-app-test', signingKey: privateKey, verificationKey: publicKey };
};

describe('module app runtime capability', () => {
  it('signs a five-minute scoped token and verifies the installation boundary', async () => {
    const keys = await createKeys();
    const token = await signModuleAppCapability(
      {
        appId: APP_ID,
        installationId: INSTALLATION_ID,
        permissions: ['data.read'],
        userId: 'user-1',
        versionId: VERSION_ID,
      },
      {
        expiresInSeconds: 300,
        keys,
        nonce: '0123456789abcdef0123456789abcdef',
        now: () => NOW,
      },
    );

    await expect(
      verifyModuleAppCapability(token, {
        installationId: INSTALLATION_ID,
        keys,
        now: () => new Date(NOW.getTime() + 60_000),
      }),
    ).resolves.toMatchObject({
      appId: APP_ID,
      aud: 'module-runtime',
      installationId: INSTALLATION_ID,
      permissions: ['data.read'],
      userId: 'user-1',
    });

    await expect(
      verifyModuleAppCapability(token, {
        installationId: '00000000-0000-4000-8000-000000000004',
        keys,
        now: () => new Date(NOW.getTime() + 60_000),
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
  });

  it('rejects excessive TTL and missing required permissions', async () => {
    const keys = await createKeys();

    await expect(
      signModuleAppCapability(
        {
          appId: APP_ID,
          installationId: INSTALLATION_ID,
          permissions: ['data.read'],
          userId: 'user-1',
          versionId: VERSION_ID,
        },
        { expiresInSeconds: 301, keys, now: () => NOW },
      ),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_TTL_INVALID');

    const token = await signModuleAppCapability(
      {
        appId: APP_ID,
        installationId: INSTALLATION_ID,
        permissions: ['data.read'],
        userId: 'user-1',
        versionId: VERSION_ID,
      },
      { keys, now: () => NOW },
    );
    await expect(
      verifyModuleAppCapability(token, {
        installationId: INSTALLATION_ID,
        keys,
        now: () => new Date(NOW.getTime() + 60_000),
        requiredPermissions: ['data.write'],
      }),
    ).rejects.toThrow('MODULE_APP_CAPABILITY_DENIED');
  });
});
