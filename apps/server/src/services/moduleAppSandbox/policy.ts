import type { ModuleAppSandboxPolicy, ModuleAppSandboxRuntime } from './contracts';

const FORBIDDEN_OVERRIDES = [
  'command',
  'cpuLimit',
  'image',
  'memoryLimitBytes',
  'mounts',
  'networkMode',
  'pidsLimit',
] as const;

const IMAGE_DIGEST_PATTERN = /^.+@sha256:[a-f0-9]{64}$/;
const MAX_TIMEOUT_MS = 300_000;

type SandboxImages = Record<ModuleAppSandboxRuntime, string>;

const getConfiguredImages = (): SandboxImages => {
  const node22 = process.env.MODULE_APP_RUNTIME_NODE22_IMAGE;
  const python312 = process.env.MODULE_APP_RUNTIME_PYTHON312_IMAGE;
  if (!node22 || !python312) throw new Error('MODULE_APP_SANDBOX_IMAGE_CONFIG_MISSING');

  return { node22, python312 };
};

export const resolveModuleAppSandboxPolicy = (
  input: unknown,
  options: { images?: SandboxImages } = {},
): ModuleAppSandboxPolicy => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('MODULE_APP_SANDBOX_POLICY_INVALID');
  }

  const value = input as Record<string, unknown>;
  if (FORBIDDEN_OVERRIDES.some((key) => key in value)) {
    throw new Error('MODULE_APP_SANDBOX_POLICY_OVERRIDE_DENIED');
  }
  if (value.runtime !== 'node22' && value.runtime !== 'python312') {
    throw new Error('MODULE_APP_SANDBOX_RUNTIME_INVALID');
  }
  if (
    typeof value.timeoutMs !== 'number' ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error('MODULE_APP_SANDBOX_TIMEOUT_INVALID');
  }

  const images = options.images ?? getConfiguredImages();
  const imageDigest = images[value.runtime];
  if (!IMAGE_DIGEST_PATTERN.test(imageDigest)) {
    throw new Error('MODULE_APP_SANDBOX_IMAGE_INVALID');
  }

  return {
    cpuLimit: 1,
    imageDigest,
    memoryLimitBytes: 256 * 1024 * 1024,
    networkMode: 'none',
    pidsLimit: 64,
    runtime: value.runtime,
    timeoutMs: value.timeoutMs,
  };
};
