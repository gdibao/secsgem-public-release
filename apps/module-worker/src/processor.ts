import path from 'node:path';

import type {
  ClaimedModuleAppBuild,
  ModuleAppBuildModel,
} from '@lobechat/database/models/moduleAppBuild';
import {
  buildDeterministicModuleAppArtifact,
  materializeModuleAppArtifact,
  ModuleAppArtifactMaterializationError,
  type ModuleAppObjectStorage,
  ModuleAppPackageSafetyError,
  publishVerifiedModuleAppArtifact,
  validateModuleAppBuildSource,
} from '@lobechat/module-app-build';
import type { ModuleAppPackageManifest } from '@lobechat/types';

import {
  classifyModuleAppBuildFailure,
  isModuleAppBuildLeaseLost,
  ModuleAppWorkerError,
} from './errors';

type BuildModel = {
  complete: (
    input: Parameters<ModuleAppBuildModel['complete']>[0],
  ) => Promise<unknown>;
  fail: (input: Parameters<ModuleAppBuildModel['fail']>[0]) => Promise<unknown>;
  retry: (
    input: Parameters<ModuleAppBuildModel['retry']>[0],
  ) => Promise<unknown>;
};
type ManifestV2 = Extract<ModuleAppPackageManifest, { manifestVersion: 2 }>;

export type ProcessModuleAppBuildDependencies = {
  artifactRoot: string;
  buildArtifact?: typeof buildDeterministicModuleAppArtifact;
  buildModel: BuildModel;
  logger?: {
    error: (event: {
      attempt: number;
      buildId: string;
      code: string;
      outcome: 'failed' | 'lease_lost' | 'retried';
    }) => void;
  };
  materializeArtifact?: typeof materializeModuleAppArtifact;
  metrics?: {
    recordStagingCleanupFailure: (event: {
      buildId: string;
      code: string;
    }) => void;
  };
  publishArtifact?: typeof publishVerifiedModuleAppArtifact;
  signal?: AbortSignal;
  storage: ModuleAppObjectStorage;
  validateSource?: typeof validateModuleAppBuildSource;
};

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;

const assertLease = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new ModuleAppWorkerError('MODULE_APP_BUILD_LEASE_LOST', 'permanent');
  }
};

const readSource = async (
  claim: ClaimedModuleAppBuild,
  storage: ModuleAppObjectStorage,
) => {
  try {
    return await storage.getObject({ key: claim.sourceStorageKey });
  } catch (error) {
    if (error instanceof ModuleAppWorkerError) {
      throw new ModuleAppWorkerError(
        'MODULE_APP_BUILD_SOURCE_DOWNLOAD_FAILED',
        'retryable',
        error,
      );
    }
    throw new ModuleAppWorkerError(
      'MODULE_APP_BUILD_SOURCE_DOWNLOAD_FAILED',
      'retryable',
      error,
    );
  }
};

const materialize = async (
  input: Parameters<typeof materializeModuleAppArtifact>[0],
  materializeArtifact: typeof materializeModuleAppArtifact,
) => {
  try {
    return await materializeArtifact(input);
  } catch (error) {
    if (error instanceof ModuleAppArtifactMaterializationError) throw error;
    if (error instanceof ModuleAppPackageSafetyError) {
      throw new ModuleAppWorkerError(
        'MODULE_APP_BUILD_SOURCE_ARCHIVE_REJECTED',
        'permanent',
      );
    }
    throw new ModuleAppWorkerError(
      'MODULE_APP_BUILD_FILESYSTEM_UNAVAILABLE',
      'retryable',
      error,
    );
  }
};

export const processModuleAppBuild = async (
  claim: ClaimedModuleAppBuild,
  dependencies: ProcessModuleAppBuildDependencies,
): Promise<'ready' | 'retried' | 'failed'> => {
  const buildArtifact =
    dependencies.buildArtifact ?? buildDeterministicModuleAppArtifact;
  const materializeArtifact =
    dependencies.materializeArtifact ?? materializeModuleAppArtifact;
  const publishArtifact =
    dependencies.publishArtifact ?? publishVerifiedModuleAppArtifact;
  const validateSource =
    dependencies.validateSource ?? validateModuleAppBuildSource;
  const log = (code: string, outcome: 'failed' | 'lease_lost' | 'retried') =>
    dependencies.logger?.error({
      attempt: claim.attemptCount,
      buildId: claim.id,
      code,
      outcome,
    });

  try {
    assertLease(dependencies.signal);
    const sourceBytes = await readSource(claim, dependencies.storage);
    assertLease(dependencies.signal);
    const validated = await validateSource({
      bytes: sourceBytes,
      expectedSourceSha256: claim.sourceSha256,
      reviewedManifest: claim.manifestSnapshot as ManifestV2,
    });
    assertLease(dependencies.signal);
    const artifact = await buildArtifact({ files: validated.files });
    assertLease(dependencies.signal);

    const storage: ModuleAppObjectStorage = {
      ...dependencies.storage,
      deleteObject: async (input) => {
        try {
          await dependencies.storage.deleteObject(input);
        } catch (error) {
          try {
            dependencies.metrics?.recordStagingCleanupFailure({
              buildId: claim.id,
              code: 'MODULE_APP_BUILD_STAGING_CLEANUP_FAILED',
            });
          } catch {
            // Cleanup metrics must not change the verified promotion outcome.
          }
          throw error;
        }
      },
    };
    const promoted = await publishArtifact({
      artifactBytes: artifact.bytes,
      artifactSha256: artifact.sha256,
      buildId: claim.id,
      claimToken: claim.claimToken,
      storage,
    });
    assertLease(dependencies.signal);

    let promotedBytes: Uint8Array;
    try {
      promotedBytes = await dependencies.storage.getObject({
        key: promoted.artifactKey,
      });
    } catch (error) {
      throw new ModuleAppWorkerError(
        'MODULE_APP_BUILD_S3_READ_FAILED',
        'retryable',
        error,
      );
    }
    assertLease(dependencies.signal);
    const materialized = await materialize(
      {
        artifactBytes: promotedBytes,
        artifactRoot: dependencies.artifactRoot,
        artifactSha256: promoted.artifactSha256,
        buildId: claim.id,
        claimToken: claim.claimToken,
        manifest: validated.manifest,
      },
      materializeArtifact,
    );
    const expectedDirectory = path.resolve(
      dependencies.artifactRoot,
      promoted.artifactSha256,
    );
    if (path.resolve(materialized.directory) !== expectedDirectory) {
      throw new ModuleAppWorkerError(
        'MODULE_APP_BUILD_MATERIALIZED_ARTIFACT_MISMATCH',
        'permanent',
      );
    }
    assertLease(dependencies.signal);
    await dependencies.buildModel.complete({
      artifactKey: promoted.artifactKey,
      artifactSha256: promoted.artifactSha256,
      buildId: claim.id,
      claimToken: claim.claimToken,
    });
    return 'ready';
  } catch (error) {
    if (isModuleAppBuildLeaseLost(error) || dependencies.signal?.aborted) {
      log('MODULE_APP_BUILD_LEASE_LOST', 'lease_lost');
      return 'failed';
    }

    const failure = classifyModuleAppBuildFailure(error);
    if (failure.disposition === 'retryable' && claim.attemptCount < 4) {
      const delayMs = RETRY_DELAYS_MS[claim.attemptCount - 1];
      if (delayMs !== undefined) {
        try {
          await dependencies.buildModel.retry({
            buildId: claim.id,
            claimToken: claim.claimToken,
            failureCode: failure.code,
            retryDelayMs: delayMs,
          });
        } catch (transitionError) {
          if (isModuleAppBuildLeaseLost(transitionError)) {
            log('MODULE_APP_BUILD_LEASE_LOST', 'lease_lost');
            return 'failed';
          }
          throw transitionError;
        }
        log(failure.code, 'retried');
        return 'retried';
      }
    }

    const failureCode =
      failure.disposition === 'retryable'
        ? 'MODULE_APP_BUILD_RETRY_EXHAUSTED'
        : failure.code;
    try {
      await dependencies.buildModel.fail({
        buildId: claim.id,
        claimToken: claim.claimToken,
        failureCode,
      });
    } catch (transitionError) {
      if (isModuleAppBuildLeaseLost(transitionError)) {
        log('MODULE_APP_BUILD_LEASE_LOST', 'lease_lost');
        return 'failed';
      }
      throw transitionError;
    }
    log(failureCode, 'failed');
    return 'failed';
  }
};
