import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ContainerModuleAppLauncher, ModuleAppRuntimeInvoker } from './invocation';

const request = {
  artifactSha256: 'a'.repeat(64),
  capability: 'signed-runtime-capability',
  entry: 'server/search.ts',
  input: { query: 'jobs' },
  invocationId: '00000000-0000-4000-8000-000000000001',
  runtime: 'node22' as const,
  timeoutMs: 1000,
};

describe('ModuleAppRuntimeInvoker', () => {
  it('delegates a validated invocation to the fixed launcher adapter', async () => {
    const launcher = {
      invoke: vi.fn().mockResolvedValue({
        output: { items: [] },
        stderr: '',
        stdout: 'completed',
      }),
    };
    const invoker = new ModuleAppRuntimeInvoker({ launcher });

    await expect(invoker.invoke(request)).resolves.toEqual({
      invocationId: request.invocationId,
      output: { items: [] },
      status: 'succeeded',
      stderr: '',
      stdout: 'completed',
    });
    expect(launcher.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'node22', timeoutMs: 1000 }),
    );
  });

  it('runs a validated artifact through the disposable container engine', async () => {
    const engine = {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: '{"items":[]}',
      }),
    };
    const launcher = new ContainerModuleAppLauncher({
      artifactRoot: '/runtime/artifacts',
      dockerArtifactRoot: '/srv/comhub/module-app-artifacts',
      engine,
      images: {
        node22: `ghcr.io/comhub/module-app-node22@sha256:${'b'.repeat(64)}`,
        python312: `ghcr.io/comhub/module-app-python312@sha256:${'c'.repeat(64)}`,
      },
    });

    await expect(launcher.invoke(request)).resolves.toMatchObject({
      output: { items: [] },
    });
    expect(engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactDirectory: path.resolve(
          '/srv/comhub/module-app-artifacts',
          request.artifactSha256,
        ),
        containerName: `module-app-${request.invocationId}`,
        entry: request.entry,
        runtime: 'node22',
      }),
    );
  });

  it('denies excessive timeouts and custom image fields before the launcher', async () => {
    const launcher = { invoke: vi.fn() };
    const invoker = new ModuleAppRuntimeInvoker({ launcher });

    await expect(invoker.invoke({ ...request, timeoutMs: 60_001 })).rejects.toThrow(
      'MODULE_APP_RUNTIME_POLICY_DENIED',
    );
    await expect(invoker.invoke({ ...request, image: 'developer/custom:latest' } as never)).rejects.toThrow(
      'MODULE_APP_RUNTIME_POLICY_DENIED',
    );
    expect(launcher.invoke).not.toHaveBeenCalled();
  });

  it('bounds launcher stdout and stderr', async () => {
    const launcher = {
      invoke: vi.fn().mockResolvedValue({ stderr: 'e'.repeat(70_000), stdout: 'o'.repeat(70_000) }),
    };
    const invoker = new ModuleAppRuntimeInvoker({ launcher });
    const result = await invoker.invoke(request);

    expect(result.stdout.length).toBeLessThanOrEqual(65_536);
    expect(result.stderr.length).toBeLessThanOrEqual(65_536);
  });
});
