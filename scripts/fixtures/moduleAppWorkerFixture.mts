import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { moduleAppPackageManifestV2Schema } from '@lobechat/types';
import { strToU8, zipSync } from 'fflate';
import pg from 'pg';
import { stringify } from 'yaml';

import { buildDeterministicModuleAppArtifact } from '../../packages/module-app-build/src/index';

const { Pool } = pg;

export type ModuleAppWorkerFixtureBuild = {
  buildId: string;
  expectedArtifactKey: string;
  expectedArtifactSha256: string;
  sourceSha256: string;
  sourceStorageKey: string;
};

export type ModuleAppWorkerFixtureState = {
  expectedHtml: string;
  ready: ModuleAppWorkerFixtureBuild;
  tampered: ModuleAppWorkerFixtureBuild;
};

type FixtureEnvironment = {
  databaseUrl: string;
  s3AccessKeyId: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3SecretAccessKey: string;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const requireEnvironment = (): FixtureEnvironment => {
  const read = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`Missing fixture environment: ${key}`);
    return value;
  };

  return {
    databaseUrl: read('DATABASE_URL'),
    s3AccessKeyId: read('S3_ACCESS_KEY_ID'),
    s3Bucket: read('S3_BUCKET'),
    s3Endpoint: read('S3_ENDPOINT'),
    s3SecretAccessKey: read('S3_SECRET_ACCESS_KEY'),
  };
};

const createSource = async (slug: string) => {
  const expectedHtml = `<!doctype html><html><body>module-worker-${slug}</body></html>\n`;
  const manifest = moduleAppPackageManifestV2Schema.parse({
    app: {
      actions: [],
      appType: 'hybrid_app',
      billing: {},
      category: 'business',
      description: 'Real worker verification fixture.',
      displayName: 'Worker Verification Fixture',
      icon: 'Package',
      pages: [],
      slug,
      tags: [],
    },
    build: { frontend: { output: 'dist', profile: 'node22-static' } },
    entitlements: [],
    manifestVersion: 2,
    packageVersion: '1.0.0',
    runtime: { functions: [], permissions: [] },
  });
  const files = {
    'dist/index.html': strToU8(expectedHtml),
    'module-app.yaml': strToU8(stringify(manifest, { sortMapEntries: true })),
  };
  const sourceBytes = zipSync(files, { level: 6 });
  const artifact = await buildDeterministicModuleAppArtifact({ files });

  return { artifact, expectedHtml, manifest, sourceBytes };
};

const insertBuild = async (input: {
  databaseUrl: string;
  expectedArtifactSha256: string;
  manifest: unknown;
  sourceBytes: Uint8Array;
  sourceSha256: string;
  sourceStorageKey: string;
}) => {
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const app = await client.query<{ id: string }>(
      `INSERT INTO module_apps
        (slug, display_name, icon, category, description, app_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        (input.manifest as { app: { slug: string } }).app.slug,
        'Worker Verification Fixture',
        'Package',
        'business',
        'Real worker verification fixture.',
        'hybrid_app',
      ],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO module_app_versions (app_id, version, manifest_snapshot, runtime_manifest)
       VALUES ($1, $2, $3::jsonb, $3::jsonb)
       RETURNING id`,
      [app.rows[0].id, '1.0.0', JSON.stringify(input.manifest)],
    );
    const packageRow = await client.query<{ id: string }>(
      `INSERT INTO module_app_packages
        (app_id, version_id, review_status, archive, file_manifest, manifest_snapshot,
         validation_report, reviewed_at)
       VALUES ($1, $2, 'approved', $3::jsonb, $4::jsonb, $5::jsonb, '[]'::jsonb, NOW())
       RETURNING id`,
      [
        app.rows[0].id,
        version.rows[0].id,
        JSON.stringify({
          fileName: 'module-app.zip',
          mimeType: 'application/zip',
          sha256: sha256(input.sourceBytes),
          sizeBytes: input.sourceBytes.byteLength,
          storageKey: input.sourceStorageKey,
        }),
        JSON.stringify([
          { path: 'module-app.yaml', sizeBytes: 1 },
          { path: 'dist/index.html', sizeBytes: 1 },
        ]),
        JSON.stringify(input.manifest),
      ],
    );
    const build = await client.query<{ id: string }>(
      `INSERT INTO module_app_builds
        (package_id, version_id, source_sha256, build_profile)
       VALUES ($1, $2, $3, 'node22-static')
       RETURNING id`,
      [packageRow.rows[0].id, version.rows[0].id, input.sourceSha256],
    );
    await client.query('COMMIT');

    return {
      buildId: build.rows[0].id,
      expectedArtifactKey: `module-app-builds/${build.rows[0].id}/${input.expectedArtifactSha256}.tgz`,
      expectedArtifactSha256: input.expectedArtifactSha256,
      sourceSha256: input.sourceSha256,
      sourceStorageKey: input.sourceStorageKey,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

export const createModuleAppWorkerFixture = async (): Promise<ModuleAppWorkerFixtureState> => {
  const environment = requireEnvironment();
  const runId = randomUUID();
  const readySource = await createSource(`worker-ready-${runId}`);
  const tamperedSource = await createSource(`worker-tampered-${runId}`);
  const s3 = new S3Client({
    credentials: {
      accessKeyId: environment.s3AccessKeyId,
      secretAccessKey: environment.s3SecretAccessKey,
    },
    endpoint: environment.s3Endpoint,
    forcePathStyle: true,
    region: 'auto',
  });
  const upload = async (key: string, body: Uint8Array) =>
    s3.send(new PutObjectCommand({ Body: body, Bucket: environment.s3Bucket, Key: key }));

  const readySourceStorageKey = `module-app-worker-fixtures/${runId}/ready.zip`;
  const tamperedSourceStorageKey = `module-app-worker-fixtures/${runId}/tampered.zip`;
  await upload(readySourceStorageKey, readySource.sourceBytes);
  await upload(tamperedSourceStorageKey, tamperedSource.sourceBytes);

  const ready = await insertBuild({
    databaseUrl: environment.databaseUrl,
    expectedArtifactSha256: readySource.artifact.sha256,
    manifest: readySource.manifest,
    sourceBytes: readySource.sourceBytes,
    sourceSha256: sha256(readySource.sourceBytes),
    sourceStorageKey: readySourceStorageKey,
  });
  const tampered = await insertBuild({
    databaseUrl: environment.databaseUrl,
    expectedArtifactSha256: tamperedSource.artifact.sha256,
    manifest: tamperedSource.manifest,
    sourceBytes: tamperedSource.sourceBytes,
    sourceSha256: '0'.repeat(64),
    sourceStorageKey: tamperedSourceStorageKey,
  });

  return { expectedHtml: readySource.expectedHtml, ready, tampered };
};

if (process.argv[2] === 'seed') {
  const outputPath = process.argv[3];
  if (!outputPath) throw new Error('Fixture state output path is required');
  await writeFile(outputPath, `${JSON.stringify(await createModuleAppWorkerFixture())}\n`, 'utf8');
}
