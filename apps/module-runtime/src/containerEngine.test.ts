import { describe, expect, it, vi } from 'vitest';

import {
  buildDockerCreateArgs,
  buildDockerStartArgs,
  DockerCliModuleAppContainerEngine,
  validateModuleAppDockerHost,
} from './containerEngine';

const input = {
  artifactDirectory: '/runtime/artifacts/' + 'a'.repeat(64),
  containerName: 'module-app-invocation-1',
  entry: 'server/search.js',
  imageDigest: `ghcr.io/comhub/module-app-node22@sha256:${'b'.repeat(64)}`,
  input: { query: 'jobs' },
  limits: {
    cpu: 1,
    memoryBytes: 256 * 1024 * 1024,
    pids: 64,
    timeoutMs: 10_000,
  },
  runtime: 'node22' as const,
};

const absentContainer = {
  exitCode: 0,
  stderr: 'Error response from daemon: No such container: module-app-invocation-1\n',
  stdout: '',
};
const removedContainer = {
  exitCode: 0,
  stderr: '',
  stdout: 'module-app-invocation-1\n',
};
const absentContainerInspect = {
  exitCode: 1,
  stderr: 'error: no such object: module-app-invocation-1\n',
  stdout: '[]',
};
const presentContainerInspect = {
  exitCode: 0,
  stderr: '',
  stdout: '[{"State":{"Status":"created"}}]',
};
const createdContainer = {
  exitCode: 0,
  stderr: '',
  stdout: `${'d'.repeat(64)}\n`,
};

describe('Docker lifecycle commands', () => {
  it('accepts only the dedicated rootless daemon socket inside the runtime container', () => {
    expect(validateModuleAppDockerHost('unix:///run/module-app-docker/docker.sock')).toBe(
      'unix:///run/module-app-docker/docker.sock',
    );
    expect(() => validateModuleAppDockerHost(undefined)).toThrow(
      'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
    );
    expect(() => validateModuleAppDockerHost('unix:///var/run/docker.sock')).toThrow(
      'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
    );
    expect(() => validateModuleAppDockerHost('tcp://docker-proxy:2375')).toThrow(
      'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
    );
  });

  it('builds a fixed isolated create command before timed execution', () => {
    expect(buildDockerCreateArgs(input, 123_456)).toEqual([
      'create',
      '--rm',
      '--label',
      'comhub.module-app.runtime=true',
      '--label',
      'comhub.module-app.expires-at=123456',
      '--name',
      'module-app-invocation-1',
      '--network',
      'none',
      '--read-only',
      '--user',
      '10001:10001',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '64',
      '--memory',
      String(256 * 1024 * 1024),
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=67108864',
      '--mount',
      `type=bind,src=${input.artifactDirectory},dst=/runtime/artifact,readonly`,
      '--workdir',
      '/runtime/artifact',
      '--env',
      'HOME=/tmp',
      '--env',
      'TMPDIR=/tmp',
      '--env',
      'LANG=C.UTF-8',
      '--env',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      '--interactive',
      input.imageDigest,
      input.entry,
    ]);
    expect(buildDockerStartArgs(input.containerName)).toEqual([
      'start',
      '--attach',
      '--interactive',
      input.containerName,
    ]);
  });

  it('rejects an image that is not pinned by sha256 digest', () => {
    expect(() =>
      buildDockerCreateArgs(
        {
          ...input,
          imageDigest: 'ghcr.io/comhub/module-app-node22:latest',
        },
        123_456,
      ),
    ).toThrow('MODULE_APP_RUNTIME_IMAGE_INVALID');
  });

  it('accepts an immutable local Docker image id for verification probes', () => {
    expect(
      buildDockerCreateArgs({ ...input, imageDigest: `sha256:${'c'.repeat(64)}` }, 123_456),
    ).toContain(`sha256:${'c'.repeat(64)}`);
  });
});

describe('DockerCliModuleAppContainerEngine', () => {
  it('accepts only a reachable rootless Docker engine as healthy', async () => {
    const rootlessRunner = {
      create: vi.fn(),
      info: vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: '["name=seccomp,profile=builtin","name=rootless"]',
      }),
      inspect: vi.fn(),
      remove: vi.fn(),
      start: vi.fn(),
    };
    const rootfulRunner = {
      ...rootlessRunner,
      info: vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: '["name=seccomp,profile=builtin"]',
      }),
    };

    await expect(
      new DockerCliModuleAppContainerEngine({ runner: rootlessRunner }).healthCheck(),
    ).resolves.toBeUndefined();
    expect(rootlessRunner.info).toHaveBeenCalledWith(2500);
    await expect(
      new DockerCliModuleAppContainerEngine({ runner: rootfulRunner }).healthCheck(),
    ).rejects.toThrow('MODULE_APP_RUNTIME_DOCKER_ROOTLESS_REQUIRED');
  });

  it('normalizes Docker probe failures without exposing daemon output', async () => {
    const runner = {
      create: vi.fn(),
      info: vi.fn().mockResolvedValue({
        exitCode: 1,
        stderr: 'dial unix /private/docker.sock: permission denied',
        stdout: '',
      }),
      inspect: vi.fn(),
      remove: vi.fn(),
      start: vi.fn(),
    };

    await expect(new DockerCliModuleAppContainerEngine({ runner }).healthCheck()).rejects.toThrow(
      'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
    );
  });

  it('creates before timed execution and always removes the named container', async () => {
    const runner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValue(removedContainer),
      start: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '{"ok":true}' }),
    };
    const engine = new DockerCliModuleAppContainerEngine({ runner });

    await expect(engine.run(input)).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: '{"ok":true}',
    });
    expect(runner.create).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 15_000 }));
    const createArgs = runner.create.mock.calls[0][0].args as string[];
    expect(createArgs).toContain('--rm');
    expect(createArgs).toContain('comhub.module-app.runtime=true');
    expect(createArgs).toContainEqual(
      expect.stringMatching(/^comhub\.module-app\.expires-at=\d+$/),
    );
    expect(runner.start).toHaveBeenCalledWith({
      args: buildDockerStartArgs(input.containerName),
      input: JSON.stringify(input.input),
      timeoutMs: 10_000,
    });
    expect(runner.create.mock.invocationCallOrder[0]).toBeLessThan(
      runner.start.mock.invocationCallOrder[0],
    );
    expect(runner.remove).toHaveBeenCalledOnce();
  });

  it('force-removes the named container when command execution fails', async () => {
    const runner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValue(removedContainer),
      start: vi.fn().mockRejectedValue(new Error('MODULE_APP_RUNTIME_TIMEOUT')),
    };
    const engine = new DockerCliModuleAppContainerEngine({ runner });

    await expect(engine.run(input)).rejects.toThrow('MODULE_APP_RUNTIME_TIMEOUT');
    expect(runner.remove).toHaveBeenCalledOnce();
    expect(runner.inspect).toHaveBeenCalledOnce();
    expect(runner.remove).toHaveBeenCalledWith('module-app-invocation-1', expect.any(Number));
  });

  it('retries cleanup when create timeout races delayed container creation', async () => {
    const runner = {
      create: vi.fn().mockRejectedValue(new Error('MODULE_APP_RUNTIME_TIMEOUT')),
      inspect: vi
        .fn()
        .mockResolvedValueOnce(presentContainerInspect)
        .mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValueOnce(absentContainer).mockResolvedValue(removedContainer),
      start: vi.fn(),
    };
    const engine = new DockerCliModuleAppContainerEngine({ runner });

    await expect(engine.run(input)).rejects.toThrow('MODULE_APP_RUNTIME_TIMEOUT');
    expect(runner.remove).toHaveBeenCalledTimes(2);
    expect(runner.inspect).toHaveBeenCalledTimes(2);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.remove).toHaveBeenNthCalledWith(2, 'module-app-invocation-1', expect.any(Number));
  });

  it('does not retry an absent container after a completed process failure', async () => {
    const metrics = {
      recordCleanupFailure: vi.fn(),
      recordInvocation: vi.fn(),
    };
    const runner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValue(removedContainer),
      start: vi.fn().mockResolvedValue({ exitCode: 1, stderr: 'failed', stdout: '' }),
    };
    const engine = new DockerCliModuleAppContainerEngine({ metrics, runner });

    await expect(engine.run(input)).rejects.toThrow('MODULE_APP_RUNTIME_PROCESS_FAILED');
    expect(runner.remove).toHaveBeenCalledOnce();
    expect(runner.inspect).toHaveBeenCalledOnce();
    expect(metrics.recordCleanupFailure).not.toHaveBeenCalled();
  });

  it('fails closed when successful execution cleanup cannot be confirmed', async () => {
    const metrics = {
      recordCleanupFailure: vi.fn(),
      recordInvocation: vi.fn(),
    };
    const runner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error('docker unavailable')),
      start: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '{"ok":true}' }),
    };
    const engine = new DockerCliModuleAppContainerEngine({ metrics, runner });

    await expect(engine.run(input)).rejects.toThrow('MODULE_APP_RUNTIME_CLEANUP_FAILED');
    expect(metrics.recordCleanupFailure).toHaveBeenCalledOnce();
    expect(metrics.recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', runtime: 'node22' }),
    );
  });

  it('reconciles only expired labeled runtime containers', async () => {
    const runner = {
      create: vi.fn(),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      list: vi.fn().mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: 'expired-container|1000\nactive-container|5000\ninvalid-container|invalid\n',
      }),
      remove: vi.fn().mockResolvedValue(removedContainer),
      start: vi.fn(),
    };
    const engine = new DockerCliModuleAppContainerEngine({ runner });

    await expect(engine.reconcileStaleContainers(2000)).resolves.toEqual({
      failed: 0,
      removed: 1,
    });
    expect(runner.remove).toHaveBeenCalledWith('expired-container', expect.any(Number));
    expect(runner.remove).not.toHaveBeenCalledWith('active-container', expect.any(Number));
    expect(runner.remove).not.toHaveBeenCalledWith('invalid-container', expect.any(Number));
  });

  it('bounds all cleanup commands by one total deadline', async () => {
    const runner = {
      create: vi.fn().mockRejectedValue(new Error('MODULE_APP_RUNTIME_TIMEOUT')),
      inspect: vi.fn().mockRejectedValue(new Error('docker unavailable')),
      remove: vi.fn().mockResolvedValue(absentContainer),
      start: vi.fn(),
    };
    const engine = new DockerCliModuleAppContainerEngine({ runner });

    const startedAt = Date.now();
    await expect(engine.run(input)).rejects.toThrow('MODULE_APP_RUNTIME_TIMEOUT');
    expect(Date.now() - startedAt).toBeLessThan(3500);
    expect(runner.remove.mock.calls.length).toBeGreaterThan(1);
    expect(runner.inspect.mock.calls.length).toBe(runner.remove.mock.calls.length);
    const calls = [...runner.remove.mock.calls, ...runner.inspect.mock.calls];
    expect(
      calls.every(
        ([containerName, timeoutMs]) =>
          containerName === 'module-app-invocation-1' &&
          typeof timeoutMs === 'number' &&
          timeoutMs > 0 &&
          timeoutMs <= 3000,
      ),
    ).toBe(true);
    const timeoutArguments = calls.map(([, timeoutMs]) => timeoutMs);
    expect(Math.min(...timeoutArguments)).toBeLessThan(Math.max(...timeoutArguments) - 1000);
  });

  it('records bounded success, timeout, OOM, and cleanup outcomes', async () => {
    const metrics = {
      recordCleanupFailure: vi.fn(),
      recordInvocation: vi.fn(),
    };
    const successRunner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValue(absentContainer),
      start: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '{}' }),
    };
    await new DockerCliModuleAppContainerEngine({ metrics, runner: successRunner }).run(input);
    expect(successRunner.remove).toHaveBeenCalledOnce();
    expect(metrics.recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded', runtime: 'node22' }),
    );

    const oomRunner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn().mockResolvedValue(absentContainerInspect),
      remove: vi.fn().mockResolvedValue(absentContainer),
      start: vi.fn().mockResolvedValue({ exitCode: 137, stderr: 'Killed', stdout: '' }),
    };
    await expect(
      new DockerCliModuleAppContainerEngine({ metrics, runner: oomRunner }).run(input),
    ).rejects.toThrow('MODULE_APP_RUNTIME_OOM');
    expect(oomRunner.remove).toHaveBeenCalledOnce();
    expect(metrics.recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'oom', runtime: 'node22' }),
    );

    const timeoutRunner = {
      create: vi.fn().mockResolvedValue(createdContainer),
      inspect: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      start: vi.fn().mockRejectedValue(new Error('MODULE_APP_RUNTIME_TIMEOUT')),
    };
    await expect(
      new DockerCliModuleAppContainerEngine({ metrics, runner: timeoutRunner }).run(input),
    ).rejects.toThrow('MODULE_APP_RUNTIME_TIMEOUT');
    expect(metrics.recordCleanupFailure).toHaveBeenCalledOnce();
    expect(metrics.recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'timeout', runtime: 'node22' }),
    );
  });
});
