import { randomUUID } from 'node:crypto';

import {
  type ModuleAppCapabilityClaims,
  moduleAppCapabilityClaimsSchema,
} from '@lobechat/types';
import { importJWK, jwtVerify, SignJWT } from 'jose';

import { authEnv } from '@/envs/auth';

type ModuleAppCapabilityKey = CryptoKey | Uint8Array;

export type ModuleAppCapabilityKeys = {
  kid: string;
  signingKey: ModuleAppCapabilityKey;
  verificationKey: ModuleAppCapabilityKey;
};

type ModuleAppCapabilityInput = Omit<
  ModuleAppCapabilityClaims,
  'aud' | 'exp' | 'iat' | 'nonce' | 'surface'
> & { surface?: ModuleAppCapabilityClaims['surface'] };

type SignOptions = {
  expiresInSeconds?: number;
  keys?: ModuleAppCapabilityKeys;
  nonce?: string;
  now?: () => Date;
};

type VerifyOptions = {
  installationId?: string;
  keys?: ModuleAppCapabilityKeys;
  nonce?: string;
  now?: () => Date;
  requiredPermissions?: string[];
  userId?: string;
  versionId?: string;
  workspaceId?: string;
};

const getDefaultCapabilityKeys = async (): Promise<ModuleAppCapabilityKeys> => {
  if (!authEnv.JWKS_KEY) throw new Error('MODULE_APP_CAPABILITY_KEY_NOT_CONFIGURED');

  let jwks: { keys?: Record<string, unknown>[] };
  try {
    jwks = JSON.parse(authEnv.JWKS_KEY);
  } catch (error) {
    throw new Error('MODULE_APP_CAPABILITY_KEY_INVALID', { cause: error });
  }

  const privateJwk = jwks.keys?.find((key) => key.alg === 'RS256' && key.kty === 'RSA');
  if (!privateJwk || typeof privateJwk.kid !== 'string') {
    throw new Error('MODULE_APP_CAPABILITY_KEY_INVALID');
  }

  const publicJwk = Object.fromEntries(
    ['alg', 'e', 'kid', 'kty', 'n', 'use']
      .filter((key) => privateJwk[key] !== undefined)
      .map((key) => [key, privateJwk[key]]),
  );

  return {
    kid: privateJwk.kid,
    signingKey: (await importJWK(privateJwk, 'RS256')) as ModuleAppCapabilityKey,
    verificationKey: (await importJWK(publicJwk, 'RS256')) as ModuleAppCapabilityKey,
  };
};

export const signModuleAppCapability = async (
  input: ModuleAppCapabilityInput,
  options: SignOptions = {},
) => {
  const expiresInSeconds = options.expiresInSeconds ?? 300;
  if (expiresInSeconds < 1 || expiresInSeconds > 300) {
    throw new Error('MODULE_APP_CAPABILITY_TTL_INVALID');
  }

  const now = options.now?.() ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const claims = moduleAppCapabilityClaimsSchema.parse({
    ...input,
    aud: 'module-runtime',
    exp: iat + expiresInSeconds,
    iat,
    nonce: options.nonce ?? randomUUID(),
  });
  const keys = options.keys ?? (await getDefaultCapabilityKeys());

  return new SignJWT({
    appId: claims.appId,
    artifactSha256: claims.artifactSha256,
    installationId: claims.installationId,
    nonce: claims.nonce,
    permissions: claims.permissions,
    surface: claims.surface,
    userId: claims.userId,
    versionId: claims.versionId,
    workspaceId: claims.workspaceId,
  })
    .setProtectedHeader({ alg: 'RS256', kid: keys.kid, typ: 'JWT' })
    .setAudience('module-runtime')
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(keys.signingKey);
};

export const verifyModuleAppCapability = async (
  token: string,
  options: VerifyOptions = {},
): Promise<ModuleAppCapabilityClaims> => {
  const keys = options.keys ?? (await getDefaultCapabilityKeys());
  let payload: unknown;

  try {
    const verified = await jwtVerify(token, keys.verificationKey, {
      algorithms: ['RS256'],
      audience: 'module-runtime',
      currentDate: options.now?.() ?? new Date(),
    });
    payload = verified.payload;
  } catch (error) {
    throw new Error('MODULE_APP_CAPABILITY_INVALID', { cause: error });
  }

  const parsed = moduleAppCapabilityClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new Error('MODULE_APP_CAPABILITY_INVALID');
  const claims = parsed.data;

  if (
    (options.installationId && claims.installationId !== options.installationId) ||
    (options.nonce && claims.nonce !== options.nonce) ||
    (options.userId && claims.userId !== options.userId) ||
    (options.versionId && claims.versionId !== options.versionId) ||
    (options.workspaceId && claims.workspaceId !== options.workspaceId)
  ) {
    throw new Error('MODULE_APP_CAPABILITY_SCOPE_MISMATCH');
  }

  if (
    options.requiredPermissions?.some((permission) => !claims.permissions.includes(permission))
  ) {
    throw new Error('MODULE_APP_CAPABILITY_DENIED');
  }

  return claims;
};
