import type { ModuleAppCapabilityClaims } from '@lobechat/types';

type DecryptionResult = { plaintext: string; wasAuthentic: boolean };

export class ModuleAppSecretsGateway {
  private readonly decrypt: (encryptedValue: string) => Promise<DecryptionResult>;
  private readonly getEncryptedValue: (input: {
    installationId: string;
    key: string;
  }) => Promise<null | string>;

  constructor(options: {
    decrypt: (encryptedValue: string) => Promise<DecryptionResult>;
    getEncryptedValue: (input: { installationId: string; key: string }) => Promise<null | string>;
  }) {
    this.decrypt = options.decrypt;
    this.getEncryptedValue = options.getEncryptedValue;
  }

  get = async (capability: ModuleAppCapabilityClaims, input: unknown, declaredKeys: string[]) => {
    if (
      !input ||
      typeof input !== 'object' ||
      !('key' in input) ||
      typeof input.key !== 'string' ||
      !/^[A-Z][A-Z0-9_]{1,79}$/.test(input.key)
    ) {
      throw new Error('MODULE_APP_SECRET_KEY_INVALID');
    }
    if (!declaredKeys.includes(input.key)) throw new Error('MODULE_APP_SECRET_NOT_DECLARED');

    const encryptedValue = await this.getEncryptedValue({
      installationId: capability.installationId,
      key: input.key,
    });
    if (!encryptedValue) return { configured: false };
    if (capability.surface !== 'runtime') return { configured: true };

    const decrypted = await this.decrypt(encryptedValue);
    if (!decrypted.wasAuthentic) throw new Error('MODULE_APP_SECRET_DECRYPT_FAILED');

    return { configured: true, value: decrypted.plaintext };
  };
}
