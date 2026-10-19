import { and, eq } from 'drizzle-orm';
import debug from 'debug';

import { adminNewapiInstances } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('newapi-instance:credentials');

const ENCRYPTED_API_KEY_PREFIX = 'kv:';
const LEGACY_KEY_VAULT_FORMAT = /^[\da-f]{24}:[\da-f]{32}:[\da-f]+$/i;

let gateKeeperPromise: Promise<KeyVaultsGateKeeper> | undefined;

const getGateKeeper = () => {
  gateKeeperPromise ??= KeyVaultsGateKeeper.initWithEnvKey();
  return gateKeeperPromise;
};

export const isEncryptedAdminProviderApiKey = (value: string | null | undefined) => {
  if (!value) return false;
  return value.startsWith(ENCRYPTED_API_KEY_PREFIX) || LEGACY_KEY_VAULT_FORMAT.test(value);
};

export const encryptAdminProviderApiKey = async (apiKey: string) => {
  const gateKeeper = await getGateKeeper();
  return `${ENCRYPTED_API_KEY_PREFIX}${await gateKeeper.encrypt(apiKey)}`;
};

export const decryptAdminProviderApiKey = async (storedApiKey: string | null | undefined) => {
  if (!storedApiKey) return '';
  if (!isEncryptedAdminProviderApiKey(storedApiKey)) return storedApiKey;

  const encrypted = storedApiKey.startsWith(ENCRYPTED_API_KEY_PREFIX)
    ? storedApiKey.slice(ENCRYPTED_API_KEY_PREFIX.length)
    : storedApiKey;
  const gateKeeper = await getGateKeeper();
  const { plaintext, wasAuthentic } = await gateKeeper.decrypt(encrypted);

  if (!wasAuthentic) {
    throw new Error('Failed to decrypt AI provider API key');
  }

  return plaintext;
};

export type AdminProviderApiKeyDecryptResult =
  | {
      apiKey: string;
      encrypted: boolean;
      ok: true;
    }
  | {
      apiKey: '';
      encrypted: boolean;
      error: Error;
      ok: false;
    };

export const tryDecryptAdminProviderApiKey = async (
  storedApiKey: string | null | undefined,
): Promise<AdminProviderApiKeyDecryptResult> => {
  const encrypted = isEncryptedAdminProviderApiKey(storedApiKey);

  try {
    return {
      apiKey: await decryptAdminProviderApiKey(storedApiKey),
      encrypted,
      ok: true,
    };
  } catch (error) {
    return {
      apiKey: '',
      encrypted,
      error: error instanceof Error ? error : new Error(String(error)),
      ok: false,
    };
  }
};

export const maybeBackfillPlaintextAdminProviderApiKey = async (
  db: any,
  params: { apiKey: string; instanceId: string },
) => {
  if (!params.apiKey || isEncryptedAdminProviderApiKey(params.apiKey)) return false;
  if (typeof db?.update !== 'function') return false;

  try {
    const encryptedApiKey = await encryptAdminProviderApiKey(params.apiKey);
    await db
      .update(adminNewapiInstances)
      .set({ apiKey: encryptedApiKey, updatedAt: new Date() })
      .where(
        and(
          eq(adminNewapiInstances.id, params.instanceId),
          eq(adminNewapiInstances.apiKey, params.apiKey),
        ),
      );

    return true;
  } catch (error) {
    log(
      'failed to encrypt legacy plaintext API key for instance %s: %s',
      params.instanceId,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
};
