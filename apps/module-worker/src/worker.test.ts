import type { ClaimedModuleAppBuild } from '@lobechat/database/models/moduleAppBuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModuleAppWorker } from './worker';

const workerId = 'worker-id';
const now = new Date('2026-07-13T00:00:00.000Z');
const claim = {
  attemptCount: 1,
  claimToken: '22222222-2222-4222-8222-222222222222',
  id: '11111111-1111-4111-8111-111111111111',
} as ClaimedModuleAppBuild;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createWorker = (overrides: Record<string, unknown> = {}) => {
  const order: string[] = [];
  const healthState = {
    eventLoopAt: new Date(0),
    lastSuccessfulPollAt: new Date(0),
    workerId,
  };
  const buildModel = {
    claimNext: vi.fn(async (): Promise<ClaimedModuleAppBuild | null> => {
      order.push('claim');
      return claim;
    }),
    failExpiredExhausted: vi.fn(async () => {
      order.push('expire');
      return [];
    }),
    getQueueStats: vi.fn(async () => {
      order.push('stats');
      return { depth: 2, oldestEligibleAgeMs: 3000 };
    }),
    renewLease: vi.fn(async () => ({})),
  };
  const metrics = {
    recordBuildDuration: vi.fn(),
    recordBuildOutcome: vi.fn(),
    recordClaim: vi.fn(),
    recordCleanup: vi.fn(),
    recordLeaseRenewal: vi.fn(),
    recordQueue: vi.fn(),
  };
  const dependencies = {
    buildModel,
    cleanup: vi.fn(async () => ({ failed: 0, removed: 0 })),
    cleanupIntervalMs: 600_000,
    healthState,
    leaseDurationMs: 60_000,
    leaseRenewalIntervalMs: 20_000,
    metrics,
    now: () => now,
    pollIntervalMs: 5000,
    processBuild: vi.fn(async () => {
      order.push('process');
      return { outcome: 'ready' as const };
    }),
    shutdownTimeoutMs: 40_000,
    workerId,
    writeHealth: vi.fn(async () => {
      order.push('health');
    }),
    ...overrides,
  };

  return {
    buildModel,
    dependencies,
    healthState,
    metrics,
    order,
    worker: new ModuleAppWorker(dependencies),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ModuleAppWorker', () => {
  it('expires exhausted rows, records stats, claims one build, processes it, and writes health', async () => {
    const { buildModel, healthState, metrics, order, worker } = createWorker();

    await expect(worker.pollOnce()).resolves.toBe(true);

    expect(order).toEqual(['expire', 'stats', 'claim', 'process', 'health']);
    expect(buildModel.claimNext).toHaveBeenCalledWith({ leaseDurationMs: 60_000, workerId });
    expect(metrics.recordQueue).toHaveBeenCalledWith({ depth: 2, oldestEligibleAgeMs: 3000 });
    expect(metrics.recordClaim).toHaveBeenCalledWith('claimed');
    expect(metrics.recordBuildOutcome).toHaveBeenCalledWith({ outcome: 'ready' });
    expect(healthState.lastSuccessfulPollAt).toEqual(now);
  });

  it('renews the active lease every 20 seconds and stops after processing', async () => {
    vi.useFakeTimers();
    const processing = deferred<{ outcome: 'ready' }>();
    const { buildModel, worker } = createWorker({
      processBuild: vi.fn(() => processing.promise),
    });

    const poll = worker.pollOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(buildModel.renewLease).toHaveBeenCalledWith({
      buildId: claim.id,
      claimToken: claim.claimToken,
      leaseDurationMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(buildModel.renewLease).toHaveBeenCalledTimes(2);

    processing.resolve({ outcome: 'ready' });
    await poll;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(buildModel.renewLease).toHaveBeenCalledTimes(2);
  });

  it('records a claim conflict when eligible work is claimed concurrently', async () => {
    const { buildModel, metrics, worker } = createWorker();
    buildModel.claimNext.mockResolvedValueOnce(null);

    await expect(worker.pollOnce()).resolves.toBe(false);

    expect(metrics.recordClaim).toHaveBeenCalledWith('conflict');
  });

  it('aborts processing when lease renewal loses the claim', async () => {
    vi.useFakeTimers();
    const processBuild = vi.fn(
      async (_claim: ClaimedModuleAppBuild, input: { signal: AbortSignal }) =>
        new Promise<{ failureCode: string; outcome: 'failed' }>((resolve) => {
          input.signal.addEventListener('abort', () =>
            resolve({ failureCode: 'MODULE_APP_BUILD_LEASE_LOST', outcome: 'failed' }),
          );
        }),
    );
    const { buildModel, metrics, worker } = createWorker({ processBuild });
    buildModel.renewLease.mockRejectedValueOnce(new Error('MODULE_APP_BUILD_LEASE_LOST'));

    const poll = worker.pollOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await poll;

    expect(processBuild.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(metrics.recordLeaseRenewal).toHaveBeenCalledWith('lost');
  });

  it('ignores an in-flight renewal failure after processing has finished', async () => {
    vi.useFakeTimers();
    const renewal = deferred<{}>();
    const processing = deferred<{ outcome: 'ready' }>();
    const { buildModel, metrics, worker } = createWorker({
      processBuild: vi.fn(() => processing.promise),
    });
    buildModel.renewLease.mockImplementationOnce(() => renewal.promise);

    const poll = worker.pollOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    processing.resolve({ outcome: 'ready' });
    await poll;
    renewal.resolve(Promise.reject(new Error('MODULE_APP_BUILD_LEASE_LOST')));
    await vi.advanceTimersByTimeAsync(0);

    expect(metrics.recordLeaseRenewal).not.toHaveBeenCalledWith('lost');
  });

  it('stops new claims on shutdown and lets the active build finish', async () => {
    const processing = deferred<{ outcome: 'ready' }>();
    const started = deferred<void>();
    const processBuild = vi.fn(() => {
      started.resolve();
      return processing.promise;
    });
    const { buildModel, worker } = createWorker({ processBuild });
    const shutdown = new AbortController();

    const run = worker.run(shutdown.signal);
    await started.promise;
    shutdown.abort();
    await Promise.resolve();
    expect(buildModel.claimNext).toHaveBeenCalledTimes(1);

    processing.resolve({ outcome: 'ready' });
    await expect(run).resolves.toBeUndefined();
    expect(buildModel.claimNext).toHaveBeenCalledTimes(1);
  });

  it('aborts an active build after the 40 second shutdown timeout', async () => {
    vi.useFakeTimers();
    let processingSignal: AbortSignal | undefined;
    const processBuild = vi.fn(
      async (_claim: ClaimedModuleAppBuild, input: { signal: AbortSignal }) => {
        processingSignal = input.signal;
        return new Promise<{ failureCode: string; outcome: 'failed' }>((resolve) => {
          input.signal.addEventListener('abort', () =>
            resolve({ failureCode: 'MODULE_APP_BUILD_LEASE_LOST', outcome: 'failed' }),
          );
        });
      },
    );
    const { worker } = createWorker({ processBuild });
    const shutdown = new AbortController();

    const run = worker.run(shutdown.signal);
    await vi.advanceTimersByTimeAsync(0);
    shutdown.abort();
    await vi.advanceTimersByTimeAsync(39_999);
    expect(processingSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(run).resolves.toBeUndefined();
    expect(processingSignal?.aborted).toBe(true);
  });

  it('waits for abort cleanup before shutdown completes after the timeout', async () => {
    vi.useFakeTimers();
    const abortCleanup = deferred<void>();
    const abortStarted = deferred<void>();
    const processBuild = vi.fn(
      async (_claim: ClaimedModuleAppBuild, input: { signal: AbortSignal }) =>
        new Promise<{ failureCode: string; outcome: 'failed' }>((resolve) => {
          input.signal.addEventListener('abort', async () => {
            abortStarted.resolve();
            await abortCleanup.promise;
            resolve({ failureCode: 'MODULE_APP_BUILD_LEASE_LOST', outcome: 'failed' });
          });
        }),
    );
    const { worker } = createWorker({ processBuild });
    const shutdown = new AbortController();

    let shutdownComplete = false;
    const run = worker.run(shutdown.signal).then(() => {
      shutdownComplete = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    shutdown.abort();
    await vi.advanceTimersByTimeAsync(40_000);
    await abortStarted.promise;

    expect(shutdownComplete).toBe(false);

    abortCleanup.resolve();
    await run;
    expect(shutdownComplete).toBe(true);
  });

  it('drains a claim in flight during shutdown before returning', async () => {
    const pendingClaim = deferred<ClaimedModuleAppBuild | null>();
    let processingSignal: AbortSignal | undefined;
    const processBuild = vi.fn(
      async (_claim: ClaimedModuleAppBuild, input: { signal: AbortSignal }) => {
        processingSignal = input.signal;
        return { failureCode: 'MODULE_APP_BUILD_LEASE_LOST', outcome: 'failed' as const };
      },
    );
    const { buildModel, worker } = createWorker({ processBuild });
    buildModel.claimNext.mockImplementationOnce(() => pendingClaim.promise);
    const shutdown = new AbortController();

    let shutdownComplete = false;
    const run = worker.run(shutdown.signal).then(() => {
      shutdownComplete = true;
    });
    await vi.waitFor(() => expect(buildModel.claimNext).toHaveBeenCalledTimes(1));
    shutdown.abort();
    await Promise.resolve();

    expect(shutdownComplete).toBe(false);

    pendingClaim.resolve(claim);
    await run;
    expect(processBuild).toHaveBeenCalledTimes(1);
    expect(processingSignal?.aborted).toBe(true);
    expect(shutdownComplete).toBe(true);
  });

  it('keeps the 40 second shutdown bound when a claim never settles', async () => {
    vi.useFakeTimers();
    const pendingClaim = deferred<ClaimedModuleAppBuild | null>();
    const { buildModel, worker } = createWorker();
    buildModel.claimNext.mockImplementationOnce(() => pendingClaim.promise);
    const shutdown = new AbortController();

    let shutdownComplete = false;
    void worker.run(shutdown.signal).then(() => {
      shutdownComplete = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    shutdown.abort();
    await vi.advanceTimersByTimeAsync(39_999);
    expect(shutdownComplete).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(shutdownComplete).toBe(true);
  });

  it('runs cleanup at startup and every ten minutes while idle polls wait five seconds', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(async () => ({ failed: 0, removed: 0 }));
    const { buildModel, worker } = createWorker({ cleanup });
    buildModel.claimNext.mockResolvedValue(null);
    const shutdown = new AbortController();

    const run = worker.run(shutdown.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(buildModel.claimNext).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(buildModel.claimNext).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(595_000);
    expect(cleanup).toHaveBeenCalledTimes(2);

    shutdown.abort();
    await vi.runAllTimersAsync();
    await run;
  });
});
