import { randomUUID as createRandomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MODULE_APP_WORKER_HEALTH_FILE =
  '/tmp/module-app-worker-health.json';

export type ModuleAppWorkerHealthState = {
  eventLoopAt: Date;
  lastSuccessfulPollAt: Date;
  workerId: string;
};

export const writeWorkerHealth = async (input: {
  healthFilePath?: string;
  state: ModuleAppWorkerHealthState;
}) => {
  const healthFilePath =
    input.healthFilePath ?? DEFAULT_MODULE_APP_WORKER_HEALTH_FILE;
  const directory = path.dirname(healthFilePath);
  const temporaryPath = `${healthFilePath}.${process.pid}.${createRandomUUID()}.tmp`;
  const payload = `${JSON.stringify({
    eventLoopAt: input.state.eventLoopAt.toISOString(),
    lastSuccessfulPollAt: input.state.lastSuccessfulPollAt.toISOString(),
    workerId: input.state.workerId,
  })}\n`;

  await mkdir(directory, { recursive: true });
  const file = await open(temporaryPath, 'wx', 0o600);
  try {
    await file.writeFile(payload, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    await rename(temporaryPath, healthFilePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

type HealthFile = {
  lastSuccessfulPollAt: string;
};

const readFreshHealth = async (
  healthFilePath: string,
  now: Date,
): Promise<HealthFile> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(healthFilePath, 'utf8'));
  } catch {
    throw new Error('MODULE_APP_WORKER_HEALTH_INVALID');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('MODULE_APP_WORKER_HEALTH_INVALID');
  }
  const lastSuccessfulPollAt = Reflect.get(parsed, 'lastSuccessfulPollAt');
  if (typeof lastSuccessfulPollAt !== 'string') {
    throw new Error('MODULE_APP_WORKER_HEALTH_INVALID');
  }
  const timestamp = new Date(lastSuccessfulPollAt).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error('MODULE_APP_WORKER_HEALTH_INVALID');
  }
  const ageMs = now.getTime() - timestamp;
  if (ageMs < 0 || ageMs > 30_000) {
    throw new Error('MODULE_APP_WORKER_HEALTH_STALE');
  }
  return { lastSuccessfulPollAt };
};

export const runHealthcheck = async (config: {
  artifactRoot: string;
  healthFilePath?: string;
  now?: () => Date;
  ping: () => Promise<void>;
  randomUUID?: () => string;
}) => {
  const healthFilePath =
    config.healthFilePath ?? DEFAULT_MODULE_APP_WORKER_HEALTH_FILE;
  await readFreshHealth(healthFilePath, (config.now ?? (() => new Date()))());
  try {
    await config.ping();
  } catch {
    throw new Error('MODULE_APP_WORKER_HEALTH_POSTGRESQL_UNAVAILABLE');
  }

  const healthDirectory = path.join(config.artifactRoot, '.health');
  const probePath = path.join(
    healthDirectory,
    `${(config.randomUUID ?? createRandomUUID)()}.probe`,
  );
  let file;
  try {
    await mkdir(healthDirectory, { recursive: true });
    file = await open(probePath, 'wx', 0o600);
    await file.writeFile('ok\n', 'utf8');
    await file.sync();
  } catch {
    throw new Error('MODULE_APP_WORKER_HEALTH_ARTIFACT_UNAVAILABLE');
  } finally {
    await file?.close().catch(() => undefined);
    await unlink(probePath).catch(() => undefined);
  }
};
