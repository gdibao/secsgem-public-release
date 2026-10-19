import {
  recordModuleAppScheduleDispatch,
  recordModuleAppWorkflowBacklog,
} from '@lobechat/observability-otel/modules/module-app';
import {
  moduleAppExecutableRuntimeSchema,
  type ModuleAppWorkflowDefinition,
} from '@lobechat/types';

import { ModuleAppWorkflowEngine } from '@/business/server/module-apps/workflows/engine';
import { createModuleAppWorkflowExecutor } from '@/business/server/module-apps/workflows/executors';
import { ModuleAppTriggerModel } from '@/database/models/moduleAppTrigger';
import { ModuleAppWorkflowModel } from '@/database/models/moduleAppWorkflow';
import type { LobeChatDatabase } from '@/database/type';
import { getServerModuleAppRuntimeConfig } from '@/server/services/moduleAppRuntime/config';

import { ModuleAppWorkflowDispatch } from './index';
import { getNextModuleAppScheduleTime } from './schedule';

type ScheduleClaim = {
  claimToken: string;
  claimExpiresAt: Date;
  id: string;
  installationId: string;
  runtimeManifest?: unknown;
  schedule: string;
  scheduledFor: Date;
  timezone: string;
  workflow?: ModuleAppWorkflowDefinition;
  workflowKey: string;
  workflowVersion: number;
};

type ScheduleRepository = {
  claimDueSchedules: (input: {
    leaseMs: number;
    limit: number;
    now: Date;
  }) => Promise<ScheduleClaim[]>;
  completeScheduleClaim: (input: {
    claimToken: string;
    claimExpiresAt: Date;
    nextRunAt: Date;
    scheduleId: string;
  }) => Promise<unknown>;
  releaseScheduleClaim: (input: {
    claimToken: string;
    claimExpiresAt: Date;
    retryAt: Date;
    scheduleId: string;
  }) => Promise<unknown>;
};

const resolveWorkflow = (claim: ScheduleClaim) => {
  if (claim.workflow) return claim.workflow;
  const manifest = claim.runtimeManifest;
  const runtime = moduleAppExecutableRuntimeSchema.safeParse(
    manifest && typeof manifest === 'object' && 'runtime' in manifest ? manifest.runtime : manifest,
  );
  if (!runtime.success) throw new Error('MODULE_APP_SCHEDULE_WORKFLOW_NOT_FOUND');
  const workflow = runtime.data.workflows?.find(
    (item) => item.key === claim.workflowKey && item.version === claim.workflowVersion,
  );
  if (!workflow) throw new Error('MODULE_APP_SCHEDULE_WORKFLOW_NOT_FOUND');
  return workflow;
};

export const runModuleAppScheduleDispatcher = async (input: {
  batchSize?: number;
  dispatch: (
    input: { installationId: string; runId: string },
    options?: { workflowRunId?: string },
  ) => Promise<unknown>;
  leaseMs?: number;
  now: Date;
  recordBacklog?: (count: number) => void;
  repository: ScheduleRepository;
  start: (input: {
    idempotencyKey: string;
    installationId: string;
    workflow: ModuleAppWorkflowDefinition;
  }) => Promise<{ id: string }>;
}) => {
  const claims = await input.repository.claimDueSchedules({
    leaseMs: input.leaseMs ?? 30_000,
    limit: Math.min(100, Math.max(1, input.batchSize ?? 25)),
    now: input.now,
  });
  (input.recordBacklog ?? recordModuleAppWorkflowBacklog)(claims.length);
  let dispatched = 0;
  let failed = 0;
  let bookkeepingFailed = 0;
  for (const claim of claims) {
    let run: { id: string };
    try {
      run = await input.start({
        idempotencyKey: `module-app-schedule:${claim.id}:${claim.scheduledFor.toISOString()}`,
        installationId: claim.installationId,
        workflow: resolveWorkflow(claim),
      });
    } catch {
      await input.repository.releaseScheduleClaim({
        claimToken: claim.claimToken,
        claimExpiresAt: claim.claimExpiresAt,
        retryAt: input.now,
        scheduleId: claim.id,
      });
      failed += 1;
      continue;
    }

    try {
      await input.dispatch(
        { installationId: claim.installationId, runId: run.id },
        { workflowRunId: run.id },
      );
      dispatched += 1;
    } catch {
      await input.repository.releaseScheduleClaim({
        claimToken: claim.claimToken,
        claimExpiresAt: claim.claimExpiresAt,
        retryAt: input.now,
        scheduleId: claim.id,
      });
      failed += 1;
      continue;
    }

    try {
      await input.repository.completeScheduleClaim({
        claimToken: claim.claimToken,
        claimExpiresAt: claim.claimExpiresAt,
        nextRunAt: getNextModuleAppScheduleTime({
          after: claim.scheduledFor,
          schedule: claim.schedule,
          timezone: claim.timezone,
        }),
        scheduleId: claim.id,
      });
    } catch {
      bookkeepingFailed += 1;
    }
  }

  return { claimed: claims.length, dispatched, failed, bookkeepingFailed };
};

export const dispatchDueModuleAppSchedules = async (input: {
  batchSize?: number;
  db: LobeChatDatabase;
  leaseMs?: number;
  now?: Date;
}) => {
  const startedAt = Date.now();
  let enabled: boolean;
  try {
    enabled = (await getServerModuleAppRuntimeConfig(input.db)).switches.scheduleDispatchEnabled;
  } catch (error) {
    recordModuleAppScheduleDispatch({ durationMs: Date.now() - startedAt, outcome: 'failed' });
    throw error;
  }
  if (!enabled) {
    recordModuleAppScheduleDispatch({ durationMs: Date.now() - startedAt, outcome: 'disabled' });
    throw new Error('MODULE_APP_SCHEDULE_DISPATCH_DISABLED');
  }

  try {
    const repository = new ModuleAppTriggerModel(input.db);
    const engine = new ModuleAppWorkflowEngine({
      execute: createModuleAppWorkflowExecutor({}),
      repository: new ModuleAppWorkflowModel(input.db),
    });
    const result = await runModuleAppScheduleDispatcher({
      batchSize: input.batchSize,
      dispatch: (payload, options) => ModuleAppWorkflowDispatch.triggerRun(payload, options),
      leaseMs: input.leaseMs,
      now: input.now ?? new Date(),
      repository,
      start: (run) => engine.start(run),
    });
    recordModuleAppScheduleDispatch({
      ...result,
      durationMs: Date.now() - startedAt,
      outcome: 'completed',
    });
    return result;
  } catch (error) {
    recordModuleAppScheduleDispatch({ durationMs: Date.now() - startedAt, outcome: 'failed' });
    throw error;
  }
};
