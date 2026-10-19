// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { ModuleAppWorkerFixtureState } from '../../../scripts/fixtures/moduleAppWorkerFixture.mts';

const { Pool } = pg;
const deadlineMs = 120_000;
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const composeDefinitionPath = path.join(
  repositoryRoot,
  'docker-compose',
  'deploy',
  'module-runtime.yml',
);
const integrationRequired = process.env.MODULE_APP_WORKER_INTEGRATION_REQUIRED === 'true';
const phase = process.env.MODULE_APP_WORKER_INTEGRATION_PHASE;

if (integrationRequired && !['runtime', 'worker'].includes(phase ?? '')) {
  throw new Error('MODULE_APP_WORKER_INTEGRATION_PHASE_REQUIRED');
}

const requireEnvironment = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing integration environment: ${key}`);
  return value;
};

const loadState = async () =>
  JSON.parse(
    await readFile(requireEnvironment('MODULE_APP_WORKER_FIXTURE_STATE'), 'utf8'),
  ) as ModuleAppWorkerFixtureState;

const waitForBuild = async (buildId: string, expectedStatus: 'failed' | 'ready') => {
  const pool = new Pool({ connectionString: requireEnvironment('DATABASE_URL'), max: 1 });
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      const result = await pool.query<{
        artifact_key: string | null;
        artifact_sha256: string | null;
        failure_code: string | null;
        status: string;
      }>(
        `SELECT status, artifact_key, artifact_sha256, failure_code
         FROM module_app_builds WHERE id = $1`,
        [buildId],
      );
      const row = result.rows[0];
      if (row?.status === expectedStatus) return row;
      if (row?.status === 'failed' || row?.status === 'ready') {
        throw new Error(`Build ${buildId} reached unexpected status ${row.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Build ${buildId} did not reach ${expectedStatus} within ${deadlineMs}ms`);
  } finally {
    await pool.end();
  }
};

const createS3 = () =>
  new S3Client({
    credentials: {
      accessKeyId: requireEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnvironment('S3_SECRET_ACCESS_KEY'),
    },
    endpoint: requireEnvironment('S3_ENDPOINT'),
    forcePathStyle: true,
    region: 'auto',
  });

const isExactS3NotFound = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return (
    candidate.$metadata?.httpStatusCode === 404 &&
    (candidate.name === 'NoSuchKey' || candidate.name === 'NotFound')
  );
};

const runWorkerContainerCommand = (args: string[]) => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      requireEnvironment('MODULE_APP_WORKER_COMPOSE_PROJECT'),
      '-f',
      requireEnvironment('MODULE_APP_WORKER_COMPOSE_FILE'),
      '--profile',
      'worker',
      'exec',
      '-T',
      'module-app-worker',
      ...args,
    ],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return result;
};

describe('module worker verification definition', () => {
  it('uses pinned S3 images and a dedicated internal Worker network without a fixed project name', async () => {
    const definition = parse(await readFile(composeDefinitionPath, 'utf8')) as {
      name?: string;
      networks?: Record<string, { internal?: boolean }>;
      services: Record<
        string,
        {
          image?: string;
          network_mode?: string;
          networks?: string[];
          tmpfs?: string[];
          volumes?: string[];
        }
      >;
    };
    const workerNetwork = 'module-app-worker-internal';
    const seedNetwork = 'module-app-seed';

    expect(definition.name).toBeUndefined();
    expect(definition.networks?.[workerNetwork]?.internal).toBe(true);
    expect(definition.networks?.[seedNetwork]?.internal ?? false).toBe(false);
    expect(definition.services['module-app-postgres'].networks).toEqual([
      workerNetwork,
      seedNetwork,
    ]);
    expect(definition.services['module-app-s3'].networks).toEqual([workerNetwork, seedNetwork]);
    expect(definition.services['module-app-s3-init'].networks).toEqual([workerNetwork]);
    expect(definition.services['module-app-worker'].networks).toEqual([workerNetwork]);
    expect(definition.services['module-app-redis'].networks ?? ['default']).not.toContain(
      workerNetwork,
    );
    expect(definition.services['module-runtime'].networks ?? ['default']).not.toContain(
      workerNetwork,
    );
    expect(definition.services['module-app-worker'].networks).not.toContain(seedNetwork);
    expect(definition.services['module-app-artifact-init'].network_mode).toBe('none');
    expect(definition.services['module-app-s3'].image).toBe(
      'rustfs/rustfs@sha256:fa19210ac4697c79d7ccca1ec9b0eb91aebacc6691991ffb14014bb3c67e6cc3',
    );
    expect(definition.services['module-app-s3-init'].image).toBe(
      'quay.io/minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727',
    );
    expect(definition.services['module-app-worker'].tmpfs).toEqual(['/tmp:size=64m,noexec,nosuid']);
    expect(definition.services['module-app-worker'].volumes).toEqual([
      'module-app-artifacts:/runtime/artifacts:rw',
    ]);
  });
});

describe('exact S3 absence classification', () => {
  it('accepts only a 404 NoSuchKey or NotFound response', () => {
    expect(isExactS3NotFound({ $metadata: { httpStatusCode: 404 }, name: 'NoSuchKey' })).toBe(true);
    expect(isExactS3NotFound({ $metadata: { httpStatusCode: 404 }, name: 'NotFound' })).toBe(true);
    expect(isExactS3NotFound({ $metadata: { httpStatusCode: 500 }, name: 'InternalError' })).toBe(
      false,
    );
    expect(isExactS3NotFound(new Error('connection refused'))).toBe(false);
  });
});

describe.skipIf(!integrationRequired || phase !== 'worker')(
  'module worker real integration',
  () => {
    it(
      'moves one approved manifest v2 ZIP from queued to ready with identical S3, database, and local identities',
      async () => {
        const state = await loadState();
        const row = await waitForBuild(state.ready.buildId, 'ready');

        expect(row.artifact_key).toBe(state.ready.expectedArtifactKey);
        expect(row.artifact_sha256).toBe(state.ready.expectedArtifactSha256);
        expect(row.failure_code).toBeNull();

        const response = await createS3().send(
          new GetObjectCommand({
            Bucket: requireEnvironment('S3_BUCKET'),
            Key: state.ready.expectedArtifactKey,
          }),
        );
        const bytes = new Uint8Array(await response.Body!.transformToByteArray());
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.artifact_sha256);

        const materialized = path.posix.join(
          '/runtime/artifacts',
          state.ready.expectedArtifactSha256,
          'dist',
          'index.html',
        );
        const localFile = runWorkerContainerCommand(['cat', materialized]);
        expect(localFile.status, localFile.stderr).toBe(0);
        expect(localFile.stdout).toBe(state.expectedHtml);
      },
      deadlineMs + 10_000,
    );

    it(
      'fails a tampered source with a bounded code and creates no final object or content directory',
      async () => {
        const state = await loadState();
        const row = await waitForBuild(state.tampered.buildId, 'failed');

        expect(row.failure_code).toBe('MODULE_APP_BUILD_SOURCE_HASH_MISMATCH');
        expect(row.failure_code).toMatch(/^MODULE_APP_[A-Z0-9_]{1,96}$/);
        expect(row.artifact_key).toBeNull();
        expect(row.artifact_sha256).toBeNull();
        let missingObjectError: unknown;
        try {
          await createS3().send(
            new HeadObjectCommand({
              Bucket: requireEnvironment('S3_BUCKET'),
              Key: state.tampered.expectedArtifactKey,
            }),
          );
        } catch (error) {
          missingObjectError = error;
        }
        expect(isExactS3NotFound(missingObjectError)).toBe(true);
        const contentDirectory = path.posix.join(
          '/runtime/artifacts',
          state.tampered.expectedArtifactSha256,
        );
        const localDirectory = runWorkerContainerCommand([
          'sh',
          '-ec',
          'test ! -e "$1"',
          'sh',
          contentDirectory,
        ]);
        expect(localDirectory.status, localDirectory.stderr).toBe(0);
      },
      deadlineMs + 10_000,
    );
  },
);

describe.skipIf(!integrationRequired || phase !== 'runtime')(
  'module runtime real integration',
  () => {
    it('serves the worker-materialized frontend through the runtime artifact route', async () => {
      const state = await loadState();
      const response = await fetch(
        `${requireEnvironment('MODULE_APP_RUNTIME_URL')}/artifacts/${state.ready.expectedArtifactSha256}/dist/index.html`,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(state.expectedHtml);
    }, 30_000);
  },
);
