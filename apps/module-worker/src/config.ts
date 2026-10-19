import path from 'node:path';

const DEFAULT_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

export type ModuleAppWorkerConfig = {
  artifactMaxBytes: number;
  artifactRoot: string;
  cleanupIntervalMs: number;
  databaseUrl: string;
  leaseDurationMs: number;
  leaseRenewalIntervalMs: number;
  maxAttempts: number;
  maxRetries: number;
  pollIntervalMs: number;
  retryDelaysMs: readonly [number, number, number];
  s3AccessKeyId: string;
  s3Bucket: string;
  s3EnablePathStyle: boolean;
  s3Endpoint: string;
  s3Region: string;
  s3SecretAccessKey: string;
  shutdownTimeoutMs: number;
  staleStagingMs: number;
};

type WorkerEnvironment = Record<string, string | undefined>;

const invalidConfig = (): never => {
  throw new Error('MODULE_APP_WORKER_CONFIG_INVALID');
};

const requireValue = (env: WorkerEnvironment, key: string) => {
  const value = env[key]?.trim();
  return value || invalidConfig();
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return invalidConfig();
};

const assertUrl = (value: string, protocols: string[]) => {
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) invalidConfig();
  } catch {
    invalidConfig();
  }
  return value;
};

export const loadModuleAppWorkerConfig = (
  env: WorkerEnvironment,
): ModuleAppWorkerConfig => {
  const artifactRoot = requireValue(env, 'MODULE_APP_ARTIFACT_ROOT');
  if (!path.isAbsolute(artifactRoot)) invalidConfig();

  return {
    artifactMaxBytes: DEFAULT_ARTIFACT_MAX_BYTES,
    artifactRoot,
    cleanupIntervalMs: 600_000,
    databaseUrl: assertUrl(requireValue(env, 'DATABASE_URL'), [
      'postgres:',
      'postgresql:',
    ]),
    leaseDurationMs: 60_000,
    leaseRenewalIntervalMs: 20_000,
    maxAttempts: 4,
    maxRetries: 3,
    pollIntervalMs: 5000,
    retryDelaysMs: [30_000, 120_000, 600_000],
    s3AccessKeyId: requireValue(env, 'S3_ACCESS_KEY_ID'),
    s3Bucket: requireValue(env, 'S3_BUCKET'),
    s3EnablePathStyle: parseBoolean(env.S3_ENABLE_PATH_STYLE, true),
    s3Endpoint: assertUrl(requireValue(env, 'S3_ENDPOINT'), [
      'http:',
      'https:',
    ]),
    s3Region: env.S3_REGION?.trim() || 'auto',
    s3SecretAccessKey: requireValue(env, 'S3_SECRET_ACCESS_KEY'),
    shutdownTimeoutMs: 40_000,
    staleStagingMs: 3_600_000,
  };
};
