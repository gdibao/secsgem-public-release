import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { verifyRuntimeCapability } from './capability';

const claims = {
  appId: '00000000-0000-4000-8000-000000000001',
  artifactSha256: 'a'.repeat(64),
  installationId: '00000000-0000-4000-8000-000000000002',
  nonce: '0123456789abcdef0123456789abcdef',
  permissions: ['data.read'],
  userId: 'user-1',
  versionId: '00000000-0000-4000-8000-000000000003',
};

const createTokenFixture = async (surface: 'browser' | 'runtime') => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ ...claims, surface })
    .setProtectedHeader({ alg: 'RS256', kid: 'module-runtime-test' })
    .setAudience('module-runtime')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
  const publicJwk = await exportJWK(publicKey);

  return {
    jwks: JSON.stringify({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'module-runtime-test', use: 'sig' }],
    }),
    token,
  };
};

describe('verifyRuntimeCapability', () => {
  it('accepts a valid runtime-surface capability', async () => {
    const fixture = await createTokenFixture('runtime');

    await expect(
      verifyRuntimeCapability(fixture.token, fixture.jwks, {
        artifactSha256: claims.artifactSha256,
      }),
    ).resolves.toMatchObject({
      artifactSha256: claims.artifactSha256,
      installationId: claims.installationId,
      surface: 'runtime',
    });
  });

  it('rejects a runtime capability for a different artifact', async () => {
    const fixture = await createTokenFixture('runtime');

    await expect(
      verifyRuntimeCapability(fixture.token, fixture.jwks, {
        artifactSha256: 'b'.repeat(64),
      }),
    ).rejects.toThrow('MODULE_APP_RUNTIME_CAPABILITY_SCOPE_MISMATCH');
  });

  it('rejects a browser-surface capability', async () => {
    const fixture = await createTokenFixture('browser');

    await expect(verifyRuntimeCapability(fixture.token, fixture.jwks)).rejects.toThrow(
      'MODULE_APP_RUNTIME_CAPABILITY_INVALID',
    );
  });
});
