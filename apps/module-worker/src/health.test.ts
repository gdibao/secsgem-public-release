import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runHealthcheck, writeWorkerHealth } from './health';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'module-worker-health-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('module worker health', () => {
  it('atomically writes bounded worker health state', async () => {
    const directory = await createTemporaryDirectory();
    const healthFilePath = path.join(directory, 'module-app-worker-health.json');
    const state = {
      eventLoopAt: new Date('2026-07-13T00:00:01.000Z'),
      lastSuccessfulPollAt: new Date('2026-07-13T00:00:00.000Z'),
      workerId: 'worker-1',
    };

    await writeWorkerHealth({ healthFilePath, state });

    expect(JSON.parse(await readFile(healthFilePath, 'utf8'))).toEqual({
      eventLoopAt: '2026-07-13T00:00:01.000Z',
      lastSuccessfulPollAt: '2026-07-13T00:00:00.000Z',
      workerId: 'worker-1',
    });
    expect(await readdir(directory)).toEqual(['module-app-worker-health.json']);
  });

  it('checks freshness, PostgreSQL, and an fsynced artifact probe without leaving files', async () => {
    const directory = await createTemporaryDirectory();
    const artifactRoot = path.join(directory, 'artifacts');
    const healthFilePath = path.join(directory, 'health.json');
    const ping = vi.fn(async () => undefined);
    await mkdir(artifactRoot, { recursive: true });
    await writeWorkerHealth({
      healthFilePath,
      state: {
        eventLoopAt: new Date('2026-07-13T00:00:00.000Z'),
        lastSuccessfulPollAt: new Date('2026-07-13T00:00:00.000Z'),
        workerId: 'worker-1',
      },
    });

    await expect(
      runHealthcheck({
        artifactRoot,
        healthFilePath,
        now: () => new Date('2026-07-13T00:00:30.000Z'),
        ping,
        randomUUID: () => 'probe-id',
      }),
    ).resolves.toBeUndefined();

    expect(ping).toHaveBeenCalledOnce();
    expect(await readdir(path.join(artifactRoot, '.health'))).toEqual([]);
  });

  it('maps PostgreSQL ping failures to a bounded health code', async () => {
    const directory = await createTemporaryDirectory();
    const healthFilePath = path.join(directory, 'health.json');
    await writeWorkerHealth({
      healthFilePath,
      state: {
        eventLoopAt: new Date('2026-07-13T00:00:00.000Z'),
        lastSuccessfulPollAt: new Date('2026-07-13T00:00:00.000Z'),
        workerId: 'worker-1',
      },
    });

    await expect(
      runHealthcheck({
        artifactRoot: directory,
        healthFilePath,
        now: () => new Date('2026-07-13T00:00:01.000Z'),
        ping: async () => {
          throw new Error('sensitive database detail');
        },
      }),
    ).rejects.toThrow(/^MODULE_APP_WORKER_HEALTH_POSTGRESQL_UNAVAILABLE$/);
  });

  it('maps artifact directory creation failures to a bounded health code', async () => {
    const directory = await createTemporaryDirectory();
    const artifactRoot = path.join(directory, 'artifact-file');
    const healthFilePath = path.join(directory, 'health.json');
    await writeFile(artifactRoot, 'not a directory');
    await writeWorkerHealth({
      healthFilePath,
      state: {
        eventLoopAt: new Date('2026-07-13T00:00:00.000Z'),
        lastSuccessfulPollAt: new Date('2026-07-13T00:00:00.000Z'),
        workerId: 'worker-1',
      },
    });

    await expect(
      runHealthcheck({
        artifactRoot,
        healthFilePath,
        now: () => new Date('2026-07-13T00:00:01.000Z'),
        ping: async () => undefined,
      }),
    ).rejects.toThrow(/^MODULE_APP_WORKER_HEALTH_ARTIFACT_UNAVAILABLE$/);
  });

  it('rejects health older than 30 seconds with a bounded code', async () => {
    const directory = await createTemporaryDirectory();
    const healthFilePath = path.join(directory, 'health.json');
    await writeWorkerHealth({
      healthFilePath,
      state: {
        eventLoopAt: new Date('2026-07-13T00:00:00.000Z'),
        lastSuccessfulPollAt: new Date('2026-07-13T00:00:00.000Z'),
        workerId: 'worker-1',
      },
    });

    await expect(
      runHealthcheck({
        artifactRoot: directory,
        healthFilePath,
        now: () => new Date('2026-07-13T00:00:31.000Z'),
        ping: vi.fn(),
      }),
    ).rejects.toThrow('MODULE_APP_WORKER_HEALTH_STALE');
  });
});
