import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(root, 'docker-compose', 'deploy', 'module-runtime.yml');
const fixtureScript = path.join(root, 'scripts', 'fixtures', 'moduleAppWorkerFixture.mts');
const migrationScript = path.join(root, 'scripts', 'migrateServerDB', 'index.ts');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const workerOnly = process.argv.includes('--worker-only');
const keepInfrastructure = process.argv.includes('--keep-infrastructure');
const runIdentity = `${process.pid}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const composeProject = `comhub-module-app-verify-${runIdentity}`;
const workerImage = `comhub-module-worker:verify-${runIdentity}`;
const runtimeImage = `comhub-module-runtime:verify-${runIdentity}`;
assert.match(composeProject, /^[a-z0-9][a-z0-9_-]*$/);
const usedPorts = new Set();
const canListenOn = (port, host) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
const canListen = async (port) =>
  (await canListenOn(port, '0.0.0.0')) && (await canListenOn(port, '::'));
const findAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '::', ipv6Only: false, port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('No port allocated'))));
    });
  });
const selectPort = async (environmentKey, preferred) => {
  const configured = process.env[environmentKey];
  if (configured) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || usedPorts.has(port)) {
      throw new Error(`Invalid ${environmentKey}`);
    }
    usedPorts.add(port);
    return port;
  }
  if (!usedPorts.has(preferred) && (await canListen(preferred))) {
    usedPorts.add(preferred);
    return preferred;
  }
  let port;
  do {
    port = await findAvailablePort();
  } while (usedPorts.has(port));
  usedPorts.add(port);
  return port;
};
const postgresPort = await selectPort('MODULE_APP_TEST_POSTGRES_PORT', 55432);
const redisPort = await selectPort('MODULE_APP_TEST_REDIS_PORT', 56379);
const runtimePort = await selectPort('MODULE_APP_TEST_RUNTIME_PORT', 53210);
const s3Port = await selectPort('MODULE_APP_TEST_S3_PORT', 59000);
const artifactRoot = mkdtempSync(path.join(os.tmpdir(), 'module-app-runtime-artifacts-'));
const artifactVolume = `comhub-module-app-artifacts-${process.pid}-${Date.now()}`;
const fixtureState = path.join(artifactRoot, '.module-app-worker-fixture.json');
const runtimeDockerSocket =
  process.env.MODULE_APP_RUNTIME_ROOTLESS_DOCKER_SOCKET ?? '/var/run/docker.sock';
const dockerGid =
  process.env.MODULE_APP_RUNTIME_ROOTLESS_DOCKER_GID ??
  (process.platform === 'linux' ? String(statSync(runtimeDockerSocket).gid) : '0');
const composeEnv = {
  COMHUB_MODULE_RUNTIME_IMAGE: runtimeImage,
  COMHUB_MODULE_WORKER_IMAGE: workerImage,
  MODULE_APP_EXECUTION_ENABLED: 'false',
  MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT: '/runtime/artifacts',
  MODULE_APP_RUNTIME_ROOTLESS_DOCKER_GID: dockerGid,
  MODULE_APP_RUNTIME_ROOTLESS_DOCKER_SOCKET: runtimeDockerSocket,
  MODULE_APP_RUNTIME_INVOCATION_ENABLED: 'false',
  MODULE_APP_TEST_ARTIFACT_VOLUME: artifactVolume,
  MODULE_APP_TEST_POSTGRES_PORT: String(postgresPort),
  MODULE_APP_TEST_REDIS_PORT: String(redisPort),
  MODULE_APP_TEST_RUNTIME_PORT: String(runtimePort),
  MODULE_APP_TEST_S3_PORT: String(s3Port),
};
const databaseUrl = `postgresql://module_app_test:module_app_test@127.0.0.1:${postgresPort}/module_app_test`;
const s3Environment = {
  S3_ACCESS_KEY_ID: 'module_app_worker_test',
  S3_BUCKET: 'module-app-worker-test',
  S3_ENDPOINT: `http://127.0.0.1:${s3Port}`,
  S3_SECRET_ACCESS_KEY: 'module_app_worker_test_secret',
};
const actionExecutionFlags = [
  'MODULE_APP_EXECUTION_ENABLED',
  'MODULE_APP_RUNTIME_INVOCATION_ENABLED',
  'MODULE_APP_WORKFLOW_PRIVILEGED_EXECUTORS_ENABLED',
  'MODULE_APP_SCHEDULE_DISPATCH_ENABLED',
  'MODULE_APP_ALIPAY_PAYMENT_CREATION_ENABLED',
  'MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED',
  'MODULE_APP_PUBLISHER_PAYOUT_RECORDING_ENABLED',
];
const execute = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    // npm exposes Bun through bun.cmd on Windows, which requires command-shell resolution.
    shell: process.platform === 'win32' && command === 'bun',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = options.capture ? `\n${result.stdout}${result.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${output}`);
  }
  return options.capture ? result.stdout.trim() : '';
};

const run = (command, args, options = {}) => execute(command, args, options);
const capture = (command, args, options = {}) =>
  execute(command, args, { ...options, capture: true });
const compose = (args, options = {}) =>
  run('docker', ['compose', '--project-name', composeProject, '-f', composeFile, ...args], {
    ...options,
    env: { ...composeEnv, ...options.env },
  });
const composeCapture = (args, options = {}) =>
  capture('docker', ['compose', '--project-name', composeProject, '-f', composeFile, ...args], {
    ...options,
    env: { ...composeEnv, ...options.env },
  });

const describeError = (error) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const cleanupInfrastructure = () => {
  const failures = [];
  const downArgs = [
    'compose',
    '--project-name',
    composeProject,
    '-f',
    composeFile,
    '--profile',
    'worker',
    '--profile',
    'runtime',
    '--profile',
    'probe',
    'down',
    '-v',
    '--remove-orphans',
  ];
  const downResult = spawnSync('docker', downArgs, {
    cwd: root,
    env: { ...process.env, ...composeEnv },
    stdio: 'inherit',
  });
  if (downResult.error) {
    failures.push(downResult.error);
  } else if (downResult.status !== 0) {
    failures.push(
      new Error(`docker ${downArgs.join(' ')} failed with exit code ${downResult.status}`),
    );
  }

  for (const image of [workerImage, runtimeImage]) {
    const inspectResult = spawnSync('docker', ['image', 'inspect', image], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (inspectResult.error) {
      failures.push(inspectResult.error);
      continue;
    }
    if (inspectResult.status !== 0) {
      if (!/No such (?:image|object)/i.test(inspectResult.stderr ?? '')) {
        failures.push(
          new Error(
            `docker image inspect ${image} failed with exit code ${inspectResult.status}: ${inspectResult.stderr?.trim()}`,
          ),
        );
      }
      continue;
    }
    const removeResult = spawnSync('docker', ['image', 'rm', '--force', image], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    if (removeResult.error) {
      failures.push(removeResult.error);
    } else if (removeResult.status !== 0) {
      failures.push(
        new Error(`docker image rm --force ${image} failed with exit code ${removeResult.status}`),
      );
    }
  }

  try {
    rmSync(artifactRoot, { force: true, recursive: true });
  } catch (error) {
    failures.push(error);
  }

  return failures.length > 0
    ? new AggregateError(failures, 'MODULE_APP_VERIFICATION_CLEANUP_FAILED')
    : undefined;
};

const combineGateAndCleanupErrors = (primaryError, cleanupError) => {
  if (!primaryError) return cleanupError;
  if (!cleanupError) return primaryError;
  return new AggregateError(
    [primaryError, cleanupError],
    `Primary failure: ${describeError(primaryError)}\nMODULE_APP_VERIFICATION_CLEANUP_FAILED: ${describeError(cleanupError)}`,
    { cause: primaryError },
  );
};

const waitForPort = (port, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} did not become reachable within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 1000);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    attempt();
  });

const runVitest = (files, options = {}) =>
  run(process.execPath, [vitest, 'run', '--silent=passed-only', ...files], options);

const resetDatabase = () =>
  compose([
    'exec',
    '-T',
    'module-app-postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'module_app_test',
    '-d',
    'module_app_test',
    '-c',
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  ]);

const migrateDatabase = () =>
  run(process.execPath, [tsx, migrationScript], {
    env: {
      DATABASE_DRIVER: 'node',
      DATABASE_URL: databaseUrl,
      KEY_VAULTS_SECRET: 'J3VydhHWbPiz9z7QAZq6bsMhyh0w3UyYQ9gYYcyshmA=',
      MIGRATION_DB: '1',
      NODE_ENV: 'module-app-verification',
    },
  });

const inspectService = (profile, service) => {
  const profileArgs = profile ? ['--profile', profile] : [];
  const id = composeCapture([...profileArgs, 'ps', '-q', service]);
  assert.ok(id, `${service} container must be running`);
  return JSON.parse(capture('docker', ['inspect', id]))[0];
};

const environmentMap = (inspect) =>
  new Map(
    (inspect.Config.Env ?? []).map((entry) => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );

const assertActionExecutionFlagsDisabled = (service, inspect) => {
  const environment = environmentMap(inspect);
  for (const flag of actionExecutionFlags) {
    assert.notEqual(environment.get(flag), 'true', `${service} must not enable ${flag}`);
  }
};

const assertWorkerContainer = () => {
  const inspect = inspectService('worker', 'module-app-worker');
  assert.equal(inspect.Config.Labels?.['com.docker.compose.project'], composeProject);
  assert.equal(inspect.Config.Image, workerImage);
  assert.equal(inspect.Config.User, '10001:10001');
  assert.equal(inspect.HostConfig.Privileged, false);
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  assert.ok(inspect.HostConfig.CapDrop?.includes('ALL'));
  assert.equal(inspect.HostConfig.CapAdd?.length ?? 0, 0);
  assert.ok(inspect.HostConfig.SecurityOpt?.includes('no-new-privileges:true'));
  const tmpfsOptions = new Set((inspect.HostConfig.Tmpfs?.['/tmp'] ?? '').split(','));
  assert.ok(tmpfsOptions.has('noexec'));
  assert.ok(tmpfsOptions.has('nosuid'));
  assert.ok(
    tmpfsOptions.has('size=64m') || tmpfsOptions.has('size=67108864'),
    'worker /tmp must be bounded to exactly 64 MiB',
  );
  assert.equal(Object.keys(inspect.HostConfig.PortBindings ?? {}).length, 0);
  assert.deepEqual(
    inspect.Mounts.filter((mount) => mount.RW).map((mount) => mount.Destination),
    ['/runtime/artifacts'],
  );
  const artifactMount = inspect.Mounts.find((mount) => mount.Destination === '/runtime/artifacts');
  assert.equal(artifactMount?.RW, true);
  assert.equal(
    inspect.Mounts.some((mount) => mount.Destination === '/var/run/docker.sock'),
    false,
  );
  const workerNetworks = Object.keys(inspect.NetworkSettings.Networks ?? {});
  assert.deepEqual(workerNetworks, [`${composeProject}_module-app-worker-internal`]);
  const workerNetwork = JSON.parse(capture('docker', ['network', 'inspect', workerNetworks[0]]))[0];
  assert.equal(workerNetwork.Internal, true);
  assert.equal(workerNetwork.Labels?.['com.docker.compose.project'], composeProject);
  if (!workerOnly) {
    const redisInspect = inspectService(undefined, 'module-app-redis');
    const redisNetworks = Object.keys(redisInspect.NetworkSettings.Networks ?? {});
    assert.equal(
      redisNetworks.some((network) => workerNetworks.includes(network)),
      false,
    );
  }
  assertActionExecutionFlagsDisabled('module-app-worker', inspect);
  compose([
    '--profile',
    'worker',
    'exec',
    '-T',
    'module-app-worker',
    'sh',
    '-ec',
    [
      'test "$(id -u):$(id -g)" = "10001:10001"',
      '! touch /root-write-probe',
      'test ! -e /var/run/docker.sock',
      `node -e "const net=require('net');const socket=net.createConnection({host:'module-app-redis',port:6379});const unreachable=()=>process.exit(0);socket.setTimeout(2000);socket.once('connect',()=>process.exit(1));socket.once('error',unreachable);socket.once('timeout',unreachable)"`,
    ].join(' && '),
  ]);
};

const assertRuntimeContainer = () => {
  const inspect = inspectService('runtime', 'module-runtime');
  assert.equal(inspect.Config.Labels?.['com.docker.compose.project'], composeProject);
  assert.equal(inspect.Config.Image, runtimeImage);
  const artifactMount = inspect.Mounts.find((mount) => mount.Destination === '/runtime/artifacts');
  assert.equal(artifactMount?.RW, false);
  const dockerArtifactRoot = environmentMap(inspect).get('MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT');
  assert.equal(dockerArtifactRoot, artifactMount?.Source);
  assert.equal(path.posix.isAbsolute(dockerArtifactRoot ?? ''), true);
  assert.equal(path.posix.resolve(dockerArtifactRoot ?? ''), dockerArtifactRoot);
  const dockerMount = inspect.Mounts.find(
    (mount) => mount.Destination === '/run/module-app-docker/docker.sock',
  );
  assert.equal(dockerMount?.RW, false);
  assert.equal(
    inspect.Mounts.some((mount) => mount.Destination === '/var/run/docker.sock'),
    false,
  );
  assert.equal(
    environmentMap(inspect).get('DOCKER_HOST'),
    'unix:///run/module-app-docker/docker.sock',
  );
  assertActionExecutionFlagsDisabled('module-runtime', inspect);
};

const runWorkerIntegrationPhase = (phase) =>
  runVitest(['apps/module-worker/src/integration.test.ts'], {
    env: {
      DATABASE_URL: databaseUrl,
      MODULE_APP_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
      MODULE_APP_WORKER_COMPOSE_FILE: composeFile,
      MODULE_APP_WORKER_COMPOSE_PROJECT: composeProject,
      MODULE_APP_WORKER_FIXTURE_STATE: fixtureState,
      MODULE_APP_WORKER_INTEGRATION_PHASE: phase,
      MODULE_APP_WORKER_INTEGRATION_REQUIRED: 'true',
      ...composeEnv,
      ...s3Environment,
    },
  });

const runWorkerGate = async () => {
  run(process.execPath, [tsx, fixtureScript, 'seed', fixtureState], {
    env: { DATABASE_URL: databaseUrl, ...s3Environment },
  });

  compose(['--profile', 'worker', 'up', '-d', '--build', 'module-app-worker']);
  try {
    runWorkerIntegrationPhase('worker');
    assertWorkerContainer();
  } finally {
    compose(['--profile', 'worker', 'stop', '-t', '45', 'module-app-worker']);
  }

  compose(['--profile', 'runtime', 'up', '-d', '--build', '--wait', 'module-runtime']);
  await waitForPort(runtimePort);
  runWorkerIntegrationPhase('runtime');
  assertRuntimeContainer();
  compose(['--profile', 'probe', 'run', '--rm', '--no-deps', 'module-app-main-probe']);
};

const databaseTests = [
  'src/models/__tests__/commercial.test.ts',
  'src/models/__tests__/commercial.topup.test.ts',
  'src/models/__tests__/moduleAppCommerce.test.ts',
  'src/models/__tests__/moduleAppCredit.test.ts',
  'src/models/__tests__/moduleAppGateway.test.ts',
  'src/models/__tests__/moduleApp.marketplace.test.ts',
  'src/models/__tests__/moduleAppApproval.test.ts',
  'src/models/__tests__/moduleAppCatalog.ownership.test.ts',
  'src/models/__tests__/moduleAppDeveloper.test.ts',
  'src/models/__tests__/moduleAppPayment.test.ts',
  'src/models/__tests__/moduleAppPublisher.test.ts',
  'src/models/__tests__/moduleAppPayout.test.ts',
];

const generalCommercialTests = [
  'src/commercialBilling.test.ts',
  'src/lambda-routers/admin/redemption.test.ts',
];

let primaryError;
try {
  runVitest(['scripts/dockerWorkspaceManifests.test.ts']);
  runVitest(['src/moduleApp/project.test.ts'], {
    cwd: path.join(root, 'apps', 'cli'),
  });
  run('bun', ['run', 'build'], {
    cwd: path.join(root, 'apps', 'cli'),
  });
  runVitest(['src/bridge.test.ts', 'src/client.test.ts'], {
    cwd: path.join(root, 'packages', 'module-app-sdk'),
  });
  run('bun', ['run', 'build'], {
    cwd: path.join(root, 'packages', 'module-app-sdk'),
  });
  runVitest(generalCommercialTests, {
    cwd: path.join(root, 'packages', 'business-server'),
  });
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
  compose([
    'up',
    '-d',
    '--wait',
    'module-app-postgres',
    'module-app-s3',
    ...(workerOnly ? [] : ['module-app-redis']),
  ]);
  compose(['run', '--rm', '--no-deps', 'module-app-s3-init']);
  compose(['run', '--rm', '--no-deps', 'module-app-artifact-init']);
  const artifactDockerRoot = capture('docker', [
    'volume',
    'inspect',
    '--format',
    '{{.Mountpoint}}',
    artifactVolume,
  ]);
  assert.equal(path.posix.isAbsolute(artifactDockerRoot), true);
  assert.equal(path.posix.resolve(artifactDockerRoot), artifactDockerRoot);
  composeEnv.MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT = artifactDockerRoot;
  await Promise.all([
    waitForPort(postgresPort),
    waitForPort(s3Port),
    ...(workerOnly ? [] : [waitForPort(redisPort)]),
  ]);
  resetDatabase();
  migrateDatabase();
  await runWorkerGate();

  if (!workerOnly) {
    runVitest(['apps/module-runtime/src/securityProbes.test.ts'], {
      env: {
        DOCKER_HOST:
          process.env.DOCKER_HOST ??
          (process.platform === 'win32'
            ? 'npipe:////./pipe/docker_engine'
            : 'unix:///var/run/docker.sock'),
        MODULE_APP_PRODUCTION_GATES_REQUIRED: 'true',
        MODULE_APP_REAL_CONTAINER_TESTS: 'true',
      },
    });
    runVitest(['apps/server/src/services/moduleAppSandbox/lease.test.ts'], {
      env: {
        MODULE_APP_PRODUCTION_GATES_REQUIRED: 'true',
        REDIS_TEST_URL: `redis://127.0.0.1:${redisPort}`,
      },
    });

    for (const testFile of databaseTests) {
      resetDatabase();
      runVitest([testFile], {
        cwd: path.join(root, 'packages', 'database'),
        env: {
          DATABASE_TEST_URL: databaseUrl,
          TEST_SERVER_DB: '1',
        },
      });
    }

    compose(['--profile', 'runtime', 'up', '-d', '--build', '--wait', 'module-runtime']);
    compose([
      '--profile',
      'runtime',
      'exec',
      '-T',
      'module-runtime',
      'sh',
      '-ec',
      [
        'test "$(id -u)" = "10001"',
        'test -r /runtime/artifacts/.verification-marker',
        '! touch /runtime/artifacts/.write-probe',
        'test ! -e /var/run/docker.sock',
        'test -S /run/module-app-docker/docker.sock',
        'docker version >/dev/null',
        `node -e "const http=require('http');const request=http.request({host:'127.0.0.1',port:3210,path:'/v1/invocations',method:'POST'},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>process.exit(response.statusCode===503&&body.includes('MODULE_APP_RUNTIME_INVOCATION_DISABLED')?0:1))});request.end('{}')"`,
      ].join(' && '),
    ]);
  }
} catch (error) {
  primaryError = error;
}

const cleanupError = keepInfrastructure ? undefined : cleanupInfrastructure();
const gateError = combineGateAndCleanupErrors(primaryError, cleanupError);
if (gateError) throw gateError;
