import type { ModuleAppOutboundHostPolicy } from '@lobechat/types';

import { ModuleAppModel } from '@/database/models/moduleApp';
import { ModuleAppBuildModel } from '@/database/models/moduleAppBuild';
import type { LobeChatDatabase } from '@/database/type';

import type { ModuleAppBuildResult } from './contracts';
import { ModuleAppBuildStorageError, ModuleAppBuildStorageService } from './storage';

type AppModel = Pick<ModuleAppModel, 'approvePackageSubmissionForAdmin'>;
type BuildModel = Pick<ModuleAppBuildModel, 'claimNext' | 'complete' | 'fail' | 'getById'>;
type BuildStorage = Pick<
  ModuleAppBuildStorageService,
  'prepareWorkerRequest' | 'promoteVerifiedArtifact'
>;

type ModuleAppBuildServiceOptions = {
  appModel?: AppModel;
  buildModel?: BuildModel;
  db?: LobeChatDatabase;
  storage?: BuildStorage;
};

export class ModuleAppBuildService {
  private readonly appModel: AppModel;
  private readonly buildModel: BuildModel;
  private readonly storage: BuildStorage;

  constructor(options: ModuleAppBuildServiceOptions) {
    if (!options.db && (!options.appModel || !options.buildModel)) {
      throw new Error('ModuleAppBuildService requires a database or both models.');
    }

    this.appModel = options.appModel ?? new ModuleAppModel(options.db!);
    this.buildModel = options.buildModel ?? new ModuleAppBuildModel(options.db!);
    this.storage = options.storage ?? new ModuleAppBuildStorageService();
  }

  approvePackage = (input: {
    outboundHostPolicies: ModuleAppOutboundHostPolicy[];
    packageId: string;
    reviewedByUserId: string;
  }) => this.appModel.approvePackageSubmissionForAdmin(input);

  claimBuild = async (input: { leaseDurationMs: number; workerId: string }) => {
    const build = await this.buildModel.claimNext(input);
    if (!build) return null;

    try {
      return await this.storage.prepareWorkerRequest(build);
    } catch (error) {
      const failureCode = 'MODULE_APP_BUILD_STORAGE_SIGNING_FAILED';
      await this.buildModel
        .fail({ buildId: build.id, claimToken: build.claimToken, failureCode })
        .catch(() => undefined);
      throw new ModuleAppBuildStorageError(failureCode, error);
    }
  };

  recordBuildResult = async (input: ModuleAppBuildResult) => {
    if (!input.claimToken) throw new Error('MODULE_APP_BUILD_LEASE_LOST');

    if (input.status === 'failed') {
      return this.buildModel.fail({
        buildId: input.buildId,
        claimToken: input.claimToken,
        failureCode: input.failureCode,
      });
    }

    const build = await this.buildModel.getById(input.buildId);
    if (!build) throw new Error('MODULE_APP_BUILD_NOT_FOUND');
    if (build.status !== 'building') throw new Error('MODULE_APP_BUILD_NOT_BUILDING');
    if (build.claimToken !== input.claimToken) throw new Error('MODULE_APP_BUILD_LEASE_LOST');
    const activeBuild = { ...build, claimToken: input.claimToken };

    try {
      const artifact = await this.storage.promoteVerifiedArtifact({
        artifactKey: input.artifactKey,
        artifactSha256: input.artifactSha256,
        build: activeBuild,
      });

      return this.buildModel.complete({
        ...artifact,
        buildId: input.buildId,
        claimToken: input.claimToken,
      });
    } catch (error) {
      const failureCode =
        error instanceof ModuleAppBuildStorageError
          ? error.code
          : 'MODULE_APP_BUILD_ARTIFACT_VERIFICATION_FAILED';
      await this.buildModel
        .fail({ buildId: input.buildId, claimToken: input.claimToken, failureCode })
        .catch(() => undefined);
      throw error instanceof ModuleAppBuildStorageError
        ? error
        : new ModuleAppBuildStorageError(failureCode, error);
    }
  };
}
