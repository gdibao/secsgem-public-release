import { register } from '@lobechat/observability-otel/node';

register({ name: 'comhub-module-worker' });

const main = async () => {
  const [
    { buildDeterministicModuleAppArtifact, materializeModuleAppArtifact },
    { cleanupStaleModuleAppStaging },
    { loadModuleAppWorkerConfig },
    { createModuleAppWorkerDatabase },
    { runHealthcheck, writeWorkerHealth },
    workerMetrics,
    { processModuleAppBuild },
    { createModuleAppWorkerStorage },
    { ModuleAppWorker },
  ] = await Promise.all([
    import('@lobechat/module-app-build'),
    import('./cleanup'),
    import('./config'),
    import('./database'),
    import('./health'),
    import('@lobechat/observability-otel/modules/module-app'),
    import('./processor'),
    import('./s3'),
    import('./worker'),
  ]);

  const config = loadModuleAppWorkerConfig(process.env);
  const database = createModuleAppWorkerDatabase(config);

  if (process.argv[2] === 'healthcheck') {
    try {
      await runHealthcheck({
        artifactRoot: config.artifactRoot,
        ping: database.ping,
      });
      process.stdout.write('MODULE_APP_WORKER_HEALTH_OK\n');
    } finally {
      await database.close();
    }
    return;
  }

  const storage = createModuleAppWorkerStorage(config);
  const workerId = crypto.randomUUID();
  const healthState = {
    eventLoopAt: new Date(0),
    lastSuccessfulPollAt: new Date(0),
    workerId,
  };
  const worker = new ModuleAppWorker({
    buildModel: database.buildModel,
    cleanup: () =>
      cleanupStaleModuleAppStaging({
        artifactRoot: config.artifactRoot,
        buildModel: database.buildModel,
        staleStagingMs: config.staleStagingMs,
      }),
    cleanupIntervalMs: config.cleanupIntervalMs,
    healthState,
    leaseDurationMs: config.leaseDurationMs,
    leaseRenewalIntervalMs: config.leaseRenewalIntervalMs,
    metrics: {
      recordBuildDuration: workerMetrics.recordModuleAppWorkerBuildDuration,
      recordBuildOutcome: workerMetrics.recordModuleAppWorkerBuildOutcome,
      recordClaim: workerMetrics.recordModuleAppWorkerClaim,
      recordCleanup: workerMetrics.recordModuleAppWorkerCleanup,
      recordLeaseRenewal: workerMetrics.recordModuleAppWorkerLeaseRenewal,
      recordQueue: workerMetrics.recordModuleAppWorkerQueue,
    },
    pollIntervalMs: config.pollIntervalMs,
    processBuild: async (claim, { signal }) => {
      let failureCode: string | undefined;
      const outcome = await processModuleAppBuild(claim, {
        artifactRoot: config.artifactRoot,
        buildArtifact: async (input) => {
          const artifact = await buildDeterministicModuleAppArtifact(input);
          workerMetrics.recordModuleAppWorkerArtifactBytes(
            artifact.bytes.byteLength,
          );
          return artifact;
        },
        buildModel: database.buildModel,
        logger: {
          error: (event) => {
            failureCode = event.code;
          },
        },
        materializeArtifact: async (input) => {
          const startedAt = Date.now();
          try {
            return await materializeModuleAppArtifact(input);
          } finally {
            workerMetrics.recordModuleAppWorkerMaterializationDuration(
              Date.now() - startedAt,
            );
          }
        },
        metrics: {
          recordStagingCleanupFailure: () =>
            workerMetrics.recordModuleAppWorkerCleanup({ failed: 1, removed: 0 }),
        },
        signal,
        storage,
      });
      return {
        ...(failureCode ? { failureCode } : {}),
        outcome: outcome === 'retried' ? ('retry' as const) : outcome,
      };
    },
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    workerId,
    writeHealth: (state) => writeWorkerHealth({ state }),
  });

  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await worker.run(shutdown.signal);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await database.close();
  }
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^MODULE_APP_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'MODULE_APP_WORKER_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
