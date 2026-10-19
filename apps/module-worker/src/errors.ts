export type ModuleAppWorkerFailureDisposition = 'permanent' | 'retryable';

export class ModuleAppWorkerError extends Error {
  constructor(
    public readonly code: string,
    public readonly disposition: ModuleAppWorkerFailureDisposition,
    public readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'ModuleAppWorkerError';
  }
}

const PERMANENT_CODES = new Set([
  'MODULE_APP_BUILD_ARTIFACT_HASH_MISMATCH',
  'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_INVALID',
  'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
  'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
  'MODULE_APP_BUILD_SOURCE_FRONTEND_OUTPUT_MISSING',
  'MODULE_APP_BUILD_SOURCE_FUNCTION_OUTPUT_MISSING',
  'MODULE_APP_BUILD_SOURCE_HASH_MISMATCH',
  'MODULE_APP_BUILD_SOURCE_MANIFEST_MISMATCH',
  'MODULE_APP_BUILD_SOURCE_MANIFEST_REJECTED',
  'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
]);

const RETRYABLE_CODES = new Set([
  'MODULE_APP_BUILD_ARTIFACT_READ_FAILED',
  'MODULE_APP_BUILD_ARTIFACT_PROMOTION_FAILED',
  'MODULE_APP_BUILD_FILESYSTEM_UNAVAILABLE',
  'MODULE_APP_BUILD_POSTGRESQL_UNAVAILABLE',
  'MODULE_APP_BUILD_S3_HEAD_FAILED',
  'MODULE_APP_BUILD_S3_READ_FAILED',
  'MODULE_APP_BUILD_S3_WRITE_FAILED',
  'MODULE_APP_BUILD_SOURCE_DOWNLOAD_FAILED',
]);

const POSTGRESQL_AVAILABILITY_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined;
  const code = Reflect.get(error, 'code');
  if (typeof code === 'string') return code;
  const message = Reflect.get(error, 'message');
  return typeof message === 'string' && message.startsWith('MODULE_APP_')
    ? message
    : undefined;
};

export const isModuleAppBuildLeaseLost = (error: unknown) =>
  getErrorCode(error) === 'MODULE_APP_BUILD_LEASE_LOST';

export const classifyModuleAppBuildFailure = (
  error: unknown,
): ModuleAppWorkerError => {
  if (error instanceof ModuleAppWorkerError) return error;

  const code = getErrorCode(error);
  if (code && PERMANENT_CODES.has(code))
    return new ModuleAppWorkerError(code, 'permanent');
  if (code && RETRYABLE_CODES.has(code))
    return new ModuleAppWorkerError(code, 'retryable');
  if (
    code &&
    (POSTGRESQL_AVAILABILITY_CODES.has(code) || code.startsWith('08'))
  ) {
    return new ModuleAppWorkerError(
      'MODULE_APP_BUILD_POSTGRESQL_UNAVAILABLE',
      'retryable',
    );
  }

  return new ModuleAppWorkerError(
    'MODULE_APP_BUILD_INTERNAL_FAILED',
    'permanent',
  );
};
