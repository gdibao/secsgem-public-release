import type { ClaimedModuleAppBuild } from '@lobechat/database/models/moduleAppBuild';

import type { ModuleAppWorkerHealthState } from './health';

type WorkerBuildModel = {
  claimNext: (input: {
    leaseDurationMs: number;
    workerId: string;
  }) => Promise<ClaimedModuleAppBuild | null>;
  failExpiredExhausted: () => Promise<unknown>;
  getQueueStats: () => Promise<{
    depth: number;
    oldestEligibleAgeMs: number;
  }>;
  renewLease: (input: {
    buildId: string;
    claimToken: string;
    leaseDurationMs: number;
  }) => Promise<unknown>;
};

type ProcessBuildResult = {
  failureCode?: string;
  outcome: 'failed' | 'ready' | 'retry';
};

type ModuleAppWorkerDependencies = {
  buildModel: WorkerBuildModel;
  cleanup: () => Promise<{ failed: number; removed: number }>;
  cleanupIntervalMs: number;
  healthState: ModuleAppWorkerHealthState;
  leaseDurationMs: number;
  leaseRenewalIntervalMs: number;
  metrics: {
    recordBuildDuration: (durationMs: number) => void;
    recordBuildOutcome: (input: ProcessBuildResult) => void;
    recordClaim: (outcome: 'claimed' | 'conflict' | 'recovered') => void;
    recordCleanup: (input: { failed: number; removed: number }) => void;
    recordLeaseRenewal: (outcome: 'lost' | 'succeeded') => void;
    recordQueue: (input: {
      depth: number;
      oldestEligibleAgeMs: number;
    }) => void;
  };
  now?: () => Date;
  pollIntervalMs: number;
  processBuild: (
    claim: ClaimedModuleAppBuild,
    input: { signal: AbortSignal },
  ) => Promise<ProcessBuildResult>;
  shutdownTimeoutMs: number;
  workerId: string;
  writeHealth: (state: ModuleAppWorkerHealthState) => Promise<void>;
};

const sleep = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, durationMs);
    signal.addEventListener('abort', finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });

const raceWithShutdown = async <T>(promise: Promise<T>, signal: AbortSignal) => {
  if (signal.aborted) return { shutdown: true as const };
  let onAbort!: () => void;
  const shutdown = new Promise<{ shutdown: true }>((resolve) => {
    onAbort = () => resolve({ shutdown: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ shutdown: false as const, value })),
      shutdown,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

export class ModuleAppWorker {
  private activeAbortController?: AbortController;
  private activePromise?: Promise<unknown>;
  private readonly now: () => Date;
  private pollingPromise?: Promise<unknown>;

  constructor(private readonly dependencies: ModuleAppWorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  pollOnce = async (signal?: AbortSignal): Promise<boolean> => {
    if (this.activePromise || this.pollingPromise) {
      throw new Error('MODULE_APP_WORKER_ALREADY_PROCESSING');
    }

    await this.dependencies.buildModel.failExpiredExhausted();
    const queue = await this.dependencies.buildModel.getQueueStats();
    this.dependencies.metrics.recordQueue(queue);
    if (signal?.aborted) {
      await this.recordHealth();
      return false;
    }

    const claim = await this.dependencies.buildModel.claimNext({
      leaseDurationMs: this.dependencies.leaseDurationMs,
      workerId: this.dependencies.workerId,
    });

    if (!claim) {
      if (queue.depth > 0) this.dependencies.metrics.recordClaim('conflict');
      await this.recordHealth();
      return false;
    }

    this.dependencies.metrics.recordClaim(
      claim.attemptCount > 1 ? 'recovered' : 'claimed',
    );
    const controller = new AbortController();
    if (signal?.aborted) controller.abort();
    this.activeAbortController = controller;
    let processingFinished = false;
    let renewalInProgress = false;
    const renewalTimer = setInterval(async () => {
      if (renewalInProgress || controller.signal.aborted) return;
      renewalInProgress = true;
      try {
        await this.dependencies.buildModel.renewLease({
          buildId: claim.id,
          claimToken: claim.claimToken,
          leaseDurationMs: this.dependencies.leaseDurationMs,
        });
        if (!processingFinished) {
          this.dependencies.metrics.recordLeaseRenewal('succeeded');
        }
      } catch {
        if (!processingFinished) {
          this.dependencies.metrics.recordLeaseRenewal('lost');
          controller.abort();
        }
      } finally {
        renewalInProgress = false;
      }
    }, this.dependencies.leaseRenewalIntervalMs);

    const startedAt = this.now().getTime();
    const processing = this.dependencies.processBuild(claim, {
      signal: controller.signal,
    });
    this.activePromise = processing;
    try {
      const result = await processing;
      this.dependencies.metrics.recordBuildOutcome(result);
      this.dependencies.metrics.recordBuildDuration(
        this.now().getTime() - startedAt,
      );
    } finally {
      processingFinished = true;
      clearInterval(renewalTimer);
      this.activeAbortController = undefined;
      this.activePromise = undefined;
    }

    await this.recordHealth();
    return true;
  };

  run = async (signal: AbortSignal): Promise<void> => {
    await this.runCleanup();
    const cleanupTimer = setInterval(
      () => void this.runCleanup(),
      this.dependencies.cleanupIntervalMs,
    );

    try {
      while (!signal.aborted) {
        const polling = this.pollOnce(signal);
        this.pollingPromise = polling;
        try {
          const result = await raceWithShutdown(polling, signal);
          if (result.shutdown) {
            await this.waitForActiveBuild();
            return;
          }
          if (!result.value) {
            await sleep(this.dependencies.pollIntervalMs, signal);
          }
        } finally {
          if (this.pollingPromise === polling) this.pollingPromise = undefined;
        }
      }
      await this.waitForActiveBuild();
    } finally {
      clearInterval(cleanupTimer);
    }
  };

  private recordHealth = async () => {
    const timestamp = this.now();
    this.dependencies.healthState.eventLoopAt = timestamp;
    this.dependencies.healthState.lastSuccessfulPollAt = timestamp;
    await this.dependencies.writeHealth(this.dependencies.healthState);
  };

  private runCleanup = async () => {
    try {
      this.dependencies.metrics.recordCleanup(await this.dependencies.cleanup());
    } catch {
      this.dependencies.metrics.recordCleanup({ failed: 1, removed: 0 });
    }
  };

  private waitForActiveBuild = async () => {
    const active = this.pollingPromise ?? this.activePromise;
    if (!active) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      active.then(
        () => false,
        () => false,
      ),
      new Promise<true>((resolve) => {
        timeout = setTimeout(() => resolve(true), this.dependencies.shutdownTimeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (timedOut) {
      const controller = this.activeAbortController;
      controller?.abort();
      if (controller) await active.catch(() => undefined);
    }
  };
}
