import { createHash } from 'node:crypto';

const MODULE_APP_BUILD_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export type ModuleAppObjectStorage = {
  deleteObject: (input: { key: string }) => Promise<void>;
  getObject: (input: { key: string }) => Promise<Uint8Array>;
  headObject: (input: { key: string }) => Promise<{ contentLength: number }>;
  putObject: (input: {
    body: Uint8Array;
    cacheControl?: string;
    contentType?: string;
    key: string;
  }) => Promise<void>;
};

export class ModuleAppArtifactStorageError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModuleAppArtifactStorageError';
  }
}

export type PublishVerifiedModuleAppArtifactInput = {
  artifactBytes: Uint8Array;
  artifactSha256: string;
  buildId: string;
  claimToken: string;
  storage: ModuleAppObjectStorage;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const assertSafeKeySegment = (value: string) => {
  if (!/^[\w.-]+$/.test(value) || value === '.' || value === '..') {
    throw new ModuleAppArtifactStorageError('MODULE_APP_BUILD_ARTIFACT_KEY_INVALID');
  }
};

const assertArtifactSize = (
  contentLength: number,
  errorCode = 'MODULE_APP_BUILD_ARTIFACT_SIZE_INVALID',
) => {
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MODULE_APP_BUILD_MAX_ARTIFACT_BYTES
  ) {
    throw new ModuleAppArtifactStorageError(errorCode);
  }
};

const readVerifiedObject = async (input: {
  expectedSha256: string;
  key: string;
  promotion: boolean;
  storage: ModuleAppObjectStorage;
}) => {
  const failureCode = input.promotion
    ? 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED'
    : 'MODULE_APP_BUILD_ARTIFACT_READ_FAILED';

  let metadata: { contentLength: number };
  try {
    metadata = await input.storage.headObject({ key: input.key });
  } catch (error) {
    throw new ModuleAppArtifactStorageError(failureCode, failureCode, error);
  }
  assertArtifactSize(
    metadata.contentLength,
    input.promotion
      ? 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED'
      : 'MODULE_APP_BUILD_ARTIFACT_SIZE_INVALID',
  );

  let bytes: Uint8Array;
  try {
    bytes = await input.storage.getObject({ key: input.key });
  } catch (error) {
    throw new ModuleAppArtifactStorageError(failureCode, failureCode, error);
  }
  if (bytes.byteLength !== metadata.contentLength) {
    throw new ModuleAppArtifactStorageError(
      input.promotion
        ? 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED'
        : 'MODULE_APP_BUILD_ARTIFACT_SIZE_MISMATCH',
    );
  }
  if (sha256(bytes) !== input.expectedSha256) {
    throw new ModuleAppArtifactStorageError(
      input.promotion
        ? 'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED'
        : 'MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH',
    );
  }

  return bytes;
};

export const publishVerifiedModuleAppArtifact = async (
  input: PublishVerifiedModuleAppArtifactInput,
): Promise<{ artifactKey: string; artifactSha256: string }> => {
  const artifactSha256 = input.artifactSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) {
    throw new ModuleAppArtifactStorageError('MODULE_APP_BUILD_ARTIFACT_HASH_INVALID');
  }
  assertSafeKeySegment(input.buildId);
  assertSafeKeySegment(input.claimToken);
  assertArtifactSize(input.artifactBytes.byteLength);
  if (sha256(input.artifactBytes) !== artifactSha256) {
    throw new ModuleAppArtifactStorageError('MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH');
  }

  const stagingKey = `module-app-build-staging/${input.buildId}/${input.claimToken}.tgz`;
  const artifactKey = `module-app-builds/${input.buildId}/${artifactSha256}.tgz`;

  try {
    await input.storage.putObject({ body: input.artifactBytes, key: stagingKey });
  } catch (error) {
    throw new ModuleAppArtifactStorageError(
      'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
      'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
      error,
    );
  }

  const verifiedBytes = await readVerifiedObject({
    expectedSha256: artifactSha256,
    key: stagingKey,
    promotion: false,
    storage: input.storage,
  });

  try {
    await input.storage.putObject({
      body: verifiedBytes,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      contentType: 'application/gzip',
      key: artifactKey,
    });
  } catch (error) {
    throw new ModuleAppArtifactStorageError(
      'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
      'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
      error,
    );
  }

  await readVerifiedObject({
    expectedSha256: artifactSha256,
    key: artifactKey,
    promotion: true,
    storage: input.storage,
  });
  await input.storage.deleteObject({ key: stagingKey }).catch(() => undefined);

  return { artifactKey, artifactSha256 };
};
