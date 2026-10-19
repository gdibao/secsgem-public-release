import { spawn } from 'node:child_process';

import {
  type ModuleAppSandboxOutcome,
  recordModuleAppSandboxCleanupFailure,
  recordModuleAppSandboxInvocation,
} from '@lobechat/observability-otel/modules/module-app';

const MAX_LOG_BYTES = 64 * 1024;
const CONTAINER_CREATE_TIMEOUT_MS = 15_000;
const CLEANUP_TIMEOUT_MS = 3000;
const HEALTH_CHECK_TIMEOUT_MS = 2500;
const CLEANUP_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 800] as const;

export type ModuleAppContainerRunInput = {
  artifactDirectory: string;
  containerName: string;
  entry: string;
  imageDigest: string;
  input: Record<string, unknown>;
  limits: {
    cpu: number;
    memoryBytes: number;
    pids: number;
    timeoutMs: number;
  };
  runtime: 'node22' | 'python312';
};

export interface ModuleAppContainerEngine {
  run: (input: ModuleAppContainerRunInput) => Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
}

type DockerRunner = {
  create: (input: { args: string[]; timeoutMs: number }) => Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
  inspect: (
    containerName: string,
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  info?: (timeoutMs: number) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  list?: (timeoutMs: number) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  remove: (
    containerName: string,
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  start: (input: { args: string[]; input: string; timeoutMs: number }) => Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
};

type ModuleAppContainerMetrics = {
  recordCleanupFailure: () => void;
  recordInvocation: (input: {
    durationMs: number;
    outcome: ModuleAppSandboxOutcome;
    runtime: 'node22' | 'python312';
  }) => void;
};

const boundedAppend = (current: string, chunk: string) =>
  current.length >= MAX_LOG_BYTES ? current : `${current}${chunk}`.slice(0, MAX_LOG_BYTES);

export const validateModuleAppDockerHost = (
  value?: string,
  options: { allowTestHost?: boolean } = {},
) => {
  if (!value || (!options.allowTestHost && value !== 'unix:///run/module-app-docker/docker.sock')) {
    throw new Error('MODULE_APP_RUNTIME_DOCKER_HOST_INVALID');
  }

  return value;
};

export const isModuleAppContainerImageDigest = (value?: string) =>
  Boolean(value && /^(?:sha256:|.+@sha256:)[a-f0-9]{64}$/.test(value));

const runDocker = (
  args: string[],
  options: { input?: string; timeoutMs: number },
): Promise<{ exitCode: number; stderr: string; stdout: string }> =>
  new Promise((resolve, reject) => {
    const dockerHost = validateModuleAppDockerHost(process.env.DOCKER_HOST, {
      allowTestHost:
        process.env.NODE_ENV === 'test' && process.env.MODULE_APP_REAL_CONTAINER_TESTS === 'true',
    });
    const child = spawn('docker', args, {
      env: { ...process.env, DOCKER_HOST: dockerHost },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handler();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('MODULE_APP_RUNTIME_TIMEOUT')));
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.once('error', (error) => {
      finish(() => reject(new Error('MODULE_APP_RUNTIME_LAUNCH_FAILED', { cause: error })));
    });
    child.once('exit', (code) => {
      finish(() => resolve({ exitCode: code ?? -1, stderr, stdout }));
    });
    child.stdin.end(options.input ?? '');
  });

const defaultRunner: DockerRunner = {
  create: ({ args, timeoutMs }) => runDocker(args, { timeoutMs }),
  inspect: (containerName, timeoutMs) => runDocker(['inspect', containerName], { timeoutMs }),
  info: (timeoutMs) => runDocker(['info', '--format', '{{json .SecurityOptions}}'], { timeoutMs }),
  list: (timeoutMs) =>
    runDocker(
      [
        'ps',
        '--all',
        '--filter',
        'label=comhub.module-app.runtime=true',
        '--format',
        '{{.ID}}|{{.Label "comhub.module-app.expires-at"}}',
      ],
      { timeoutMs },
    ),
  remove: (containerName, timeoutMs) => runDocker(['rm', '--force', containerName], { timeoutMs }),
  start: ({ args, input, timeoutMs }) => runDocker(args, { input, timeoutMs }),
};

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const classifyDockerRemoval = (result: {
  exitCode: number;
  stderr: string;
}): 'absent' | 'removed' => {
  if (/no such container/i.test(result.stderr)) return 'absent';
  if (result.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_CLEANUP_FAILED');
  return 'removed';
};

const dockerInspectShowsContainer = (result: { exitCode: number; stderr: string }): boolean => {
  if (/no such (?:object|container)/i.test(result.stderr)) return false;
  if (result.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_CLEANUP_FAILED');
  return true;
};

export const buildDockerCreateArgs = (input: ModuleAppContainerRunInput, expiresAtMs: number) => {
  if (!isModuleAppContainerImageDigest(input.imageDigest)) {
    throw new Error('MODULE_APP_RUNTIME_IMAGE_INVALID');
  }

  return [
    'create',
    '--rm',
    '--label',
    'comhub.module-app.runtime=true',
    '--label',
    `comhub.module-app.expires-at=${expiresAtMs}`,
    '--name',
    input.containerName,
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
    String(input.limits.pids),
    '--memory',
    String(input.limits.memoryBytes),
    '--cpus',
    String(input.limits.cpu),
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
  ];
};

export const buildDockerStartArgs = (containerName: string) => [
  'start',
  '--attach',
  '--interactive',
  containerName,
];

export class DockerCliModuleAppContainerEngine implements ModuleAppContainerEngine {
  private readonly metrics: ModuleAppContainerMetrics;
  private readonly runner: DockerRunner;

  constructor(options: { metrics?: ModuleAppContainerMetrics; runner?: DockerRunner } = {}) {
    this.metrics = options.metrics ?? {
      recordCleanupFailure: recordModuleAppSandboxCleanupFailure,
      recordInvocation: recordModuleAppSandboxInvocation,
    };
    this.runner = options.runner ?? defaultRunner;
  }

  healthCheck = async () => {
    if (!this.runner.info) throw new Error('MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE');

    try {
      const result = await this.runner.info(HEALTH_CHECK_TIMEOUT_MS);
      if (result.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE');

      const securityOptions = JSON.parse(result.stdout) as unknown;
      if (!Array.isArray(securityOptions)) {
        throw new Error('MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE');
      }
      if (
        !securityOptions.some(
          (option) => typeof option === 'string' && option.split(',').includes('name=rootless'),
        )
      ) {
        throw new Error('MODULE_APP_RUNTIME_DOCKER_ROOTLESS_REQUIRED');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
          'MODULE_APP_RUNTIME_DOCKER_ROOTLESS_REQUIRED',
        ].includes(error.message)
      ) {
        throw error;
      }
      throw new Error('MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE', { cause: error });
    }
  };

  private cleanupContainer = async (containerName: string, retryAbsent: boolean) => {
    const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
    const retryDelays = retryAbsent ? [0, ...CLEANUP_RETRY_DELAYS_MS] : [0];
    let clean = false;
    let removed = false;

    for (const retryDelayMs of retryDelays) {
      if (retryDelayMs > 0) {
        const remainingBeforeDelay = deadline - Date.now();
        if (remainingBeforeDelay <= 0) break;
        await wait(Math.min(retryDelayMs, remainingBeforeDelay));
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        const outcome = classifyDockerRemoval(await this.runner.remove(containerName, remainingMs));
        removed ||= outcome === 'removed';

        const remainingAfterRemoveMs = deadline - Date.now();
        if (remainingAfterRemoveMs <= 0) break;
        clean = !dockerInspectShowsContainer(
          await this.runner.inspect(containerName, remainingAfterRemoveMs),
        );
        if (clean && (!retryAbsent || removed)) return true;
      } catch {
        clean = false;
        if (!retryAbsent) return false;
      }
    }

    return clean;
  };

  reconcileStaleContainers = async (nowMs = Date.now()) => {
    if (!this.runner.list) return { failed: 0, removed: 0 };

    let listed: { exitCode: number; stderr: string; stdout: string };
    try {
      listed = await this.runner.list(CLEANUP_TIMEOUT_MS);
      if (listed.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_CLEANUP_FAILED');
    } catch (error) {
      this.metrics.recordCleanupFailure();
      throw error;
    }

    let failed = 0;
    let removed = 0;
    for (const line of listed.stdout.split(/\r?\n/)) {
      const [containerId, rawExpiresAt] = line.trim().split('|');
      const expiresAt = Number(rawExpiresAt);
      if (!containerId || !Number.isFinite(expiresAt) || expiresAt > nowMs) continue;

      if (await this.cleanupContainer(containerId, true)) {
        removed++;
      } else {
        failed++;
        this.metrics.recordCleanupFailure();
      }
    }

    return { failed, removed };
  };

  run = async (input: ModuleAppContainerRunInput) => {
    const startedAt = Date.now();
    let outcome: ModuleAppSandboxOutcome = 'failed';
    let cleanupRequired = false;
    let failure: unknown;
    let result: { exitCode: number; stderr: string; stdout: string } | undefined;

    try {
      const expiresAtMs =
        Date.now() + CONTAINER_CREATE_TIMEOUT_MS + input.limits.timeoutMs + CLEANUP_TIMEOUT_MS;
      const createArgs = buildDockerCreateArgs(input, expiresAtMs);
      cleanupRequired = true;
      const created = await this.runner.create({
        args: createArgs,
        timeoutMs: CONTAINER_CREATE_TIMEOUT_MS,
      });
      if (created.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_LAUNCH_FAILED');

      result = await this.runner.start({
        args: buildDockerStartArgs(input.containerName),
        input: JSON.stringify(input.input),
        timeoutMs: input.limits.timeoutMs,
      });
      if (result.exitCode === 137) {
        outcome = 'oom';
        throw new Error('MODULE_APP_RUNTIME_OOM');
      }
      if (result.exitCode !== 0) throw new Error('MODULE_APP_RUNTIME_PROCESS_FAILED');
      outcome = 'succeeded';
    } catch (error) {
      failure = error;
      if (error instanceof Error && error.message === 'MODULE_APP_RUNTIME_TIMEOUT') {
        outcome = 'timeout';
      } else if (error instanceof Error && error.message === 'MODULE_APP_RUNTIME_OOM') {
        outcome = 'oom';
      }
    }

    if (cleanupRequired) {
      // A timed-out create may still register its name; a created container must always be removed.
      const cleaned = await this.cleanupContainer(
        input.containerName,
        failure instanceof Error && failure.message === 'MODULE_APP_RUNTIME_TIMEOUT',
      );
      if (!cleaned) {
        this.metrics.recordCleanupFailure();
        if (!failure) {
          failure = new Error('MODULE_APP_RUNTIME_CLEANUP_FAILED');
          outcome = 'failed';
        }
      }
    }

    this.metrics.recordInvocation({
      durationMs: Date.now() - startedAt,
      outcome,
      runtime: input.runtime,
    });

    if (failure) throw failure;
    return result!;
  };
}
