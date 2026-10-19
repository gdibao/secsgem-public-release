import path from 'node:path';

import type { ModuleAppInvocation } from '@lobechat/types';

import {
  DockerCliModuleAppContainerEngine,
  type ModuleAppContainerEngine,
} from './containerEngine';
import { assertModuleAppRuntimePolicy } from './policy';

const MODULE_APP_RUNTIME_MAX_LOG_BYTES = 64 * 1024;
const MODULE_APP_RUNTIME_ARTIFACT_ROOT = '/runtime/artifacts';

type LauncherResult = {
  output?: unknown;
  stderr?: string;
  stdout?: string;
};

export type ModuleAppRuntimeLauncher = {
  invoke: (input: ModuleAppInvocation) => Promise<LauncherResult>;
};

const boundLog = (value = '') => value.slice(0, MODULE_APP_RUNTIME_MAX_LOG_BYTES);

export class ModuleAppRuntimeInvoker {
  private readonly launcher: ModuleAppRuntimeLauncher;

  constructor(options: { launcher: ModuleAppRuntimeLauncher }) {
    this.launcher = options.launcher;
  }

  invoke = async (rawInput: unknown) => {
    const input = assertModuleAppRuntimePolicy(rawInput);
    const result = await this.launcher.invoke(input);

    return {
      invocationId: input.invocationId,
      output: result.output,
      status: 'succeeded' as const,
      stderr: boundLog(result.stderr),
      stdout: boundLog(result.stdout),
    };
  };
}

type RuntimeImages = Record<ModuleAppInvocation['runtime'], string>;

const getRuntimeImages = (): RuntimeImages => {
  const node22 = process.env.MODULE_APP_RUNTIME_NODE22_IMAGE;
  const python312 = process.env.MODULE_APP_RUNTIME_PYTHON312_IMAGE;
  if (!node22 || !python312) throw new Error('MODULE_APP_RUNTIME_CONFIG_MISSING');
  return { node22, python312 };
};

export class ContainerModuleAppLauncher implements ModuleAppRuntimeLauncher {
  private readonly artifactRoot: string;
  private readonly dockerArtifactRoot: string;
  private readonly engine: ModuleAppContainerEngine;
  private readonly images: RuntimeImages;

  constructor(options: {
    artifactRoot?: string;
    dockerArtifactRoot?: string;
    engine?: ModuleAppContainerEngine;
    images?: RuntimeImages;
  } = {}) {
    this.artifactRoot = options.artifactRoot ?? MODULE_APP_RUNTIME_ARTIFACT_ROOT;
    this.dockerArtifactRoot = options.dockerArtifactRoot ?? this.artifactRoot;
    this.engine = options.engine ?? new DockerCliModuleAppContainerEngine();
    this.images = options.images ?? getRuntimeImages();
  }

  invoke = async (input: ModuleAppInvocation): Promise<LauncherResult> => {
    const artifactDirectory = path.resolve(this.artifactRoot, input.artifactSha256);
    const entry = path.resolve(artifactDirectory, input.entry);
    const relativeEntry = path.relative(artifactDirectory, entry);
    if (!relativeEntry || relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
      throw new Error('MODULE_APP_RUNTIME_POLICY_DENIED');
    }

    const result = await this.engine.run({
      artifactDirectory: path.resolve(this.dockerArtifactRoot, input.artifactSha256),
      containerName: `module-app-${input.invocationId}`,
      entry: relativeEntry.replaceAll('\\', '/'),
      imageDigest: this.images[input.runtime],
      input: input.input,
      limits: {
        cpu: 1,
        memoryBytes: 256 * 1024 * 1024,
        pids: 64,
        timeoutMs: input.timeoutMs,
      },
      runtime: input.runtime,
    });

    let output: unknown;
    try {
      output = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
    } catch {
      output = undefined;
    }
    return {
      output,
      stderr: boundLog(result.stderr),
      stdout: boundLog(result.stdout),
    };
  };
}

export class FixedProcessModuleAppLauncher extends ContainerModuleAppLauncher {}
