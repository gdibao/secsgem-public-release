import { describe, expect, it } from 'vitest';

import { resolveModuleAppSandboxPolicy } from './policy';

const images = {
  node22: `ghcr.io/comhub/module-app-node22@sha256:${'a'.repeat(64)}`,
  python312: `ghcr.io/comhub/module-app-python312@sha256:${'b'.repeat(64)}`,
};

describe('resolveModuleAppSandboxPolicy', () => {
  it('returns the fixed node runtime policy', () => {
    expect(
      resolveModuleAppSandboxPolicy({
        runtime: 'node22',
        timeoutMs: 12_000,
      }, { images }),
    ).toEqual({
      cpuLimit: 1,
      imageDigest: images.node22,
      memoryLimitBytes: 256 * 1024 * 1024,
      networkMode: 'none',
      pidsLimit: 64,
      runtime: 'node22',
      timeoutMs: 12_000,
    });
  });

  it.each(['image', 'command', 'mounts', 'networkMode', 'cpuLimit', 'memoryLimitBytes', 'pidsLimit'])(
    'rejects the developer-controlled %s override',
    (key) => {
      expect(() =>
        resolveModuleAppSandboxPolicy({
          [key]: key === 'networkMode' ? 'host' : 'developer-value',
          runtime: 'python312',
          timeoutMs: 1_000,
        }, { images }),
      ).toThrow('MODULE_APP_SANDBOX_POLICY_OVERRIDE_DENIED');
    },
  );

  it('rejects a timeout outside the production sandbox bounds', () => {
    expect(() =>
      resolveModuleAppSandboxPolicy(
        { runtime: 'node22', timeoutMs: 300_001 },
        { images },
      ),
    ).toThrow('MODULE_APP_SANDBOX_TIMEOUT_INVALID');
  });

  it('rejects an unpinned platform image configuration', () => {
    expect(() =>
      resolveModuleAppSandboxPolicy(
        { runtime: 'node22', timeoutMs: 1_000 },
        { images: { ...images, node22: 'ghcr.io/comhub/module-app-node22:latest' } },
      ),
    ).toThrow('MODULE_APP_SANDBOX_IMAGE_INVALID');
  });
});
