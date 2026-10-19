import { recordModuleAppArtifactCleanup } from '@lobechat/observability-otel/modules/module-app';

import {
  MODULE_APP_ARTIFACT_CLEANUP_MAX_ATTEMPTS,
  ModuleAppArtifactCleanupModel,
} from '@/database/models/moduleAppArtifactCleanup';
import type { LobeChatDatabase } from '@/database/type';
import { FileS3 } from '@/server/modules/S3';

type CleanupModel = Pick<
  ModuleAppArtifactCleanupModel,
  'claimPending' | 'markFailure' | 'markReleased'
>;
type CleanupStorage = Pick<FileS3, 'deleteFile'>;

const MODULE_APP_ARTIFACT_KEY_PATTERN =
  /^module-apps\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\//i;

const isMissingObjectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  return ['code', 'name', 'statusCode'].some((key) => {
    if (!(key in error)) return false;
    return ['404', 'NotFound', 'NoSuchKey', 'ObjectNotFound'].includes(
      String((error as Record<string, unknown>)[key]),
    );
  });
};

const toStorageErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'MODULE_APP_ARTIFACT_DELETE_FAILED';

  for (const key of ['code', 'name', 'statusCode']) {
    if (!(key in error)) continue;
    const value = String((error as Record<string, unknown>)[key]).replaceAll(/[^\w-]/g, '');
    if (value) return `MODULE_APP_ARTIFACT_DELETE_${value}`;
  }

  return 'MODULE_APP_ARTIFACT_DELETE_FAILED';
};

export class ModuleAppArtifactCleanupService {
  private readonly model: CleanupModel;
  private readonly storage: CleanupStorage;

  constructor(options: { db?: LobeChatDatabase; model?: CleanupModel; storage?: CleanupStorage }) {
    if (!options.model && !options.db) {
      throw new Error('ModuleAppArtifactCleanupService requires a database or model.');
    }

    this.model = options.model ?? new ModuleAppArtifactCleanupModel(options.db!);
    this.storage = options.storage ?? new FileS3();
  }

  cleanupPending = async (limit = 100) => {
    const jobs = await this.model.claimPending(limit);
    let failed = 0;
    let released = 0;
    let retrying = 0;

    for (const job of jobs) {
      if (!MODULE_APP_ARTIFACT_KEY_PATTERN.test(job.storageKey)) {
        await this.model.markFailure({
          error: 'MODULE_APP_ARTIFACT_STORAGE_KEY_INVALID',
          id: job.id,
          retryable: false,
        });
        failed += 1;
        continue;
      }

      try {
        await this.storage.deleteFile(job.storageKey);
      } catch (error) {
        if (!isMissingObjectError(error)) {
          const retryable = job.attemptCount < MODULE_APP_ARTIFACT_CLEANUP_MAX_ATTEMPTS;
          await this.model.markFailure({
            error: toStorageErrorCode(error),
            id: job.id,
            retryable,
          });
          retryable ? (retrying += 1) : (failed += 1);
          continue;
        }
      }

      if (await this.model.markReleased(job.id)) released += 1;
      else failed += 1;
    }

    recordModuleAppArtifactCleanup({ failed, released, retrying });
    return { claimed: jobs.length, failed, released, retrying };
  };
}
