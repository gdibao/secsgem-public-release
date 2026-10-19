import type { ModuleAppCapabilityClaims } from '@lobechat/types';

type PreSignedUpload = { headers?: Record<string, string>; url: string };

type ModuleAppFileStorage = {
  createPrivatePreSignedUpload: (key: string) => Promise<PreSignedUpload>;
  createPreSignedUrlForPreview: (key: string, expiresIn?: number) => Promise<string>;
};

const getStoragePrefix = (installationId: string) =>
  `module-app-installations/${installationId}/files/`;

const getPublicPrefix = (installationId: string) => `${installationId}/files/`;

const getExtension = (fileName: string) => {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
  return extension ? `.${extension}` : '';
};

export class ModuleAppFileGateway {
  private readonly randomId: () => string;
  private readonly storage: ModuleAppFileStorage;

  constructor(options: { randomId?: () => string; storage: ModuleAppFileStorage }) {
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.storage = options.storage;
  }

  createUpload = async (capability: ModuleAppCapabilityClaims, input: unknown) => {
    if (
      !input ||
      typeof input !== 'object' ||
      !('fileName' in input) ||
      typeof input.fileName !== 'string' ||
      input.fileName.length < 1 ||
      input.fileName.length > 255
    ) {
      throw new Error('MODULE_APP_FILE_INPUT_INVALID');
    }

    const objectName = `${this.randomId()}${getExtension(input.fileName)}`;
    const key = `${getPublicPrefix(capability.installationId)}${objectName}`;
    const upload = await this.storage.createPrivatePreSignedUpload(
      `${getStoragePrefix(capability.installationId)}${objectName}`,
    );

    return { headers: upload.headers ?? {}, key, uploadUrl: upload.url };
  };

  createDownload = async (capability: ModuleAppCapabilityClaims, input: unknown) => {
    if (!input || typeof input !== 'object' || !('key' in input) || typeof input.key !== 'string') {
      throw new Error('MODULE_APP_FILE_INPUT_INVALID');
    }

    const publicPrefix = getPublicPrefix(capability.installationId);
    if (!input.key.startsWith(publicPrefix)) throw new Error('MODULE_APP_FILE_SCOPE_DENIED');
    const objectName = input.key.slice(publicPrefix.length);
    if (!/^[\w.-]{1,180}$/.test(objectName)) {
      throw new Error('MODULE_APP_FILE_SCOPE_DENIED');
    }

    const downloadUrl = await this.storage.createPreSignedUrlForPreview(
      `${getStoragePrefix(capability.installationId)}${objectName}`,
      15 * 60,
    );
    return { downloadUrl };
  };
}
