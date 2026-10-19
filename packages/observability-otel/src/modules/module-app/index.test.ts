import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recordModuleAppArtifactCleanup,
  recordModuleAppInstallationLifecycle,
  recordModuleAppOperationalAge,
  recordModuleAppPaymentVerificationFailure,
  recordModuleAppPayoutState,
  recordModuleAppSandboxInvocation,
  recordModuleAppSandboxReplayRejection,
  recordModuleAppScheduleDispatch,
  recordModuleAppWorkerArtifactBytes,
  recordModuleAppWorkerBuildDuration,
  recordModuleAppWorkerBuildOutcome,
  recordModuleAppWorkerClaim,
  recordModuleAppWorkerCleanup,
  recordModuleAppWorkerLeaseRenewal,
  recordModuleAppWorkerMaterializationDuration,
  recordModuleAppWorkerQueue,
  recordModuleAppWorkflowBacklog,
} from './index';

const instruments = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: (name: string) => {
        const add = vi.fn();
        instruments.set(name, add);
        return { add };
      },
      createHistogram: (name: string) => {
        const record = vi.fn();
        instruments.set(name, record);
        return { record };
      },
    }),
  },
}));

describe('module app observability', () => {
  beforeEach(() => {
    for (const instrument of instruments.values()) instrument.mockClear();
  });

  it('records bounded sandbox and workflow dimensions without resource identifiers', () => {
    recordModuleAppSandboxInvocation({
      durationMs: 123,
      outcome: 'timeout',
      runtime: 'node22',
    });
    recordModuleAppSandboxReplayRejection();
    recordModuleAppWorkflowBacklog(42);

    expect(instruments.get('module_app_sandbox_invocations_total')).toHaveBeenCalledWith(1, {
      outcome: 'timeout',
      runtime: 'node22',
    });
    expect(instruments.get('module_app_sandbox_duration_ms')).toHaveBeenCalledWith(123, {
      outcome: 'timeout',
      runtime: 'node22',
    });
    expect(instruments.get('module_app_workflow_backlog')).toHaveBeenCalledWith(42);
  });

  it('records schedule dispatcher passes and non-zero item outcomes', () => {
    recordModuleAppScheduleDispatch({
      bookkeepingFailed: 1,
      claimed: 4,
      dispatched: 2,
      durationMs: 321,
      failed: 2,
      outcome: 'completed',
    });

    expect(instruments.get('module_app_schedule_dispatch_passes_total')).toHaveBeenCalledWith(1, {
      outcome: 'completed',
    });
    expect(instruments.get('module_app_schedule_dispatch_duration_ms')).toHaveBeenCalledWith(321, {
      outcome: 'completed',
    });
    expect(instruments.get('module_app_schedule_dispatch_items_total')).toHaveBeenNthCalledWith(
      1,
      4,
      { outcome: 'claimed' },
    );
    expect(instruments.get('module_app_schedule_dispatch_items_total')).toHaveBeenNthCalledWith(
      2,
      2,
      { outcome: 'dispatched' },
    );
    expect(instruments.get('module_app_schedule_dispatch_items_total')).toHaveBeenNthCalledWith(
      3,
      2,
      { outcome: 'failed' },
    );
    expect(instruments.get('module_app_schedule_dispatch_items_total')).toHaveBeenNthCalledWith(
      4,
      1,
      { outcome: 'bookkeeping_failed' },
    );
  });

  it('bounds payment reasons, ages, and payout states', () => {
    recordModuleAppPaymentVerificationFailure('unexpected-provider-message');
    recordModuleAppOperationalAge('refund', 3_600_000);
    recordModuleAppPayoutState('paid');

    expect(instruments.get('module_app_payment_verification_failures_total')).toHaveBeenCalledWith(
      1,
      { reason: 'other' },
    );
    expect(instruments.get('module_app_operational_age_ms')).toHaveBeenCalledWith(3_600_000, {
      kind: 'refund',
    });
    expect(instruments.get('module_app_payout_state_total')).toHaveBeenCalledWith(1, {
      state: 'paid',
    });
  });

  it('records worker operations with bounded attributes and values', () => {
    recordModuleAppWorkerClaim('recovered');
    recordModuleAppWorkerLeaseRenewal('lost');
    recordModuleAppWorkerBuildOutcome({
      failureCode: 'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
      outcome: 'failed',
    });
    recordModuleAppWorkerBuildDuration(321);
    recordModuleAppWorkerQueue({ depth: 7.9, oldestEligibleAgeMs: 456 });
    recordModuleAppWorkerArtifactBytes(Number.POSITIVE_INFINITY);
    recordModuleAppWorkerMaterializationDuration(-1);
    recordModuleAppWorkerCleanup({ failed: 2, removed: 3 });

    expect(instruments.get('module_app_worker_claims_total')).toHaveBeenCalledWith(1, {
      outcome: 'recovered',
    });
    expect(instruments.get('module_app_worker_lease_renewals_total')).toHaveBeenCalledWith(1, {
      outcome: 'lost',
    });
    expect(instruments.get('module_app_worker_build_outcomes_total')).toHaveBeenCalledWith(1, {
      failure_code: 'MODULE_APP_BUILD_SOURCE_POLICY_REJECTED',
      outcome: 'failed',
    });
    expect(instruments.get('module_app_worker_build_duration_ms')).toHaveBeenCalledWith(321);
    expect(instruments.get('module_app_worker_queue_depth')).toHaveBeenCalledWith(7);
    expect(instruments.get('module_app_worker_queue_oldest_eligible_age_ms')).toHaveBeenCalledWith(
      456,
    );
    expect(instruments.get('module_app_worker_artifact_bytes')).toHaveBeenCalledWith(0);
    expect(instruments.get('module_app_worker_materialization_duration_ms')).toHaveBeenCalledWith(
      0,
    );
    expect(instruments.get('module_app_worker_cleanup_total')).toHaveBeenCalledWith(3, {
      outcome: 'removed',
    });
    expect(instruments.get('module_app_worker_cleanup_total')).toHaveBeenCalledWith(2, {
      outcome: 'failed',
    });
  });

  it('maps unknown worker failure codes to other without identifier attributes', () => {
    recordModuleAppWorkerBuildOutcome({
      failureCode: 'build-id=user-id-storage-key',
      outcome: 'failed',
    });

    const call = instruments.get('module_app_worker_build_outcomes_total')!.mock.calls[0];
    expect(call).toEqual([1, { failure_code: 'other', outcome: 'failed' }]);
    expect(JSON.stringify(call)).not.toMatch(
      /build_id|package|version|worker|application|user|storage/i,
    );
  });

  it('records artifact cleanup and installation lifecycle with bounded dimensions', () => {
    recordModuleAppArtifactCleanup({ failed: 1, released: 3.8, retrying: 2 });
    recordModuleAppInstallationLifecycle({
      changed: false,
      operation: 'uninstall',
      scope: 'workspace',
    });

    expect(instruments.get('module_app_artifact_cleanup_total')).toHaveBeenNthCalledWith(1, 3, {
      outcome: 'released',
    });
    expect(instruments.get('module_app_artifact_cleanup_total')).toHaveBeenNthCalledWith(2, 2, {
      outcome: 'retrying',
    });
    expect(instruments.get('module_app_artifact_cleanup_total')).toHaveBeenNthCalledWith(3, 1, {
      outcome: 'failed',
    });
    expect(instruments.get('module_app_installation_lifecycle_total')).toHaveBeenCalledWith(1, {
      operation: 'uninstall',
      outcome: 'noop',
      scope: 'workspace',
    });
  });
});
