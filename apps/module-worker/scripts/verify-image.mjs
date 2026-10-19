import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const image = 'comhub-module-worker:test';
const repositoryRoot = new URL('../../..', import.meta.url);

assert.ok(existsSync(new URL('../Dockerfile', import.meta.url)), 'worker Dockerfile must exist');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout;
};

run('docker', ['build', '-f', 'apps/module-worker/Dockerfile', '-t', image, '.'], {
  stdio: 'inherit',
});

const config = JSON.parse(
  run('docker', ['image', 'inspect', image, '--format', '{{json .Config}}']),
);

assert.equal(config.User, '10001:10001');
assert.equal(config.ExposedPorts, undefined);
assert.deepEqual(config.Entrypoint, ['/sbin/tini', '--']);
assert.deepEqual(config.Cmd, ['node', '/app/worker.mjs']);
assert.deepEqual(config.Healthcheck, {
  Interval: 10_000_000_000,
  Retries: 3,
  StartPeriod: 15_000_000_000,
  Test: ['CMD', 'node', '/app/worker.mjs', 'healthcheck'],
  Timeout: 5_000_000_000,
});

const runtimePolicy = String.raw`
const fs = require('node:fs');
const failures = [];
for (const path of [
  '/var/run/docker.sock',
  '/usr/bin/docker',
  '/bin/bash',
  '/usr/bin/bash',
  '/sbin/apk',
  '/usr/bin/apk',
  '/usr/sbin/apk',
  '/usr/local/bin/npm',
  '/usr/local/bin/npx',
  '/usr/local/bin/pnpm',
  '/usr/local/bin/corepack',
  '/usr/local/bin/yarn',
  '/usr/local/lib/node_modules',
  '/usr/local/lib/node_modules/npm',
  '/usr/local/lib/node_modules/corepack',
  '/usr/bin/gcc',
  '/usr/bin/g++',
  '/usr/bin/make',
  '/usr/bin/python3',
  '/app/src',
  '/app/node_modules',
  '/app/package.json',
]) {
  if (fs.existsSync(path)) failures.push(path);
}
const appEntries = fs.readdirSync('/app');
if (appEntries.length !== 1 || appEntries[0] !== 'worker.mjs') failures.push('/app contents');
const artifacts = fs.statSync('/runtime/artifacts');
if (artifacts.uid !== 10001 || artifacts.gid !== 10001) failures.push('/runtime/artifacts ownership');
if (failures.length > 0) {
  process.stderr.write(failures.join(', ') + '\n');
  process.exit(1);
}
`;

run('docker', ['run', '--rm', '--entrypoint', 'node', image, '-e', runtimePolicy], {
  stdio: 'inherit',
});

const healthcheck = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--env',
    'DATABASE_URL=postgresql://worker:secret@127.0.0.1:5432/module-worker',
    '--env',
    'MODULE_APP_ARTIFACT_ROOT=/runtime/artifacts',
    '--env',
    'S3_ACCESS_KEY_ID=worker',
    '--env',
    'S3_BUCKET=module-app-worker-test',
    '--env',
    'S3_ENDPOINT=http://127.0.0.1:9000',
    '--env',
    'S3_SECRET_ACCESS_KEY=secret',
    image,
    'node',
    '/app/worker.mjs',
    'healthcheck',
  ],
  { cwd: repositoryRoot, encoding: 'utf8' },
);
const healthcheckOutput = `${healthcheck.stdout}${healthcheck.stderr}`.trim();

assert.notEqual(healthcheck.status, 0, 'healthcheck without a health file must fail closed');
assert.doesNotMatch(healthcheckOutput, /Dynamic require/);
assert.match(healthcheckOutput, /^MODULE_APP_WORKER_HEALTH_INVALID$/);
