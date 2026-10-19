import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../..');

const readRepositoryFile = (filename) => readFileSync(path.join(repositoryRoot, filename), 'utf8');

const collectYamlFiles = (directoryPath) =>
  readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return collectYamlFiles(entryPath);
    return /\.ya?ml$/u.test(entry.name) ? [entryPath] : [];
  });

const loadWorkflow = (filename) => {
  const source = readFileSync(path.join(directory, filename), 'utf8');
  return { source, workflow: parse(source) };
};

const assertManualOnly = (workflow) => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
};

const assertProductionLock = (job) => {
  assert.equal(job.environment, 'production');
  assert.equal(job.concurrency.group, 'comhub-production-deploy');
  assert.equal(job.concurrency['cancel-in-progress'], false);
};

const assertPinnedMainTooling = (source, workflow, jobName) => {
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/su);
  assert.match(source, /refs\/heads\/main:refs\/remotes\/origin\/main/u);
  const checkout = workflow.jobs[jobName].steps.find(
    (step) => step.name === 'Checkout deployment tooling',
  );
  assert.equal(checkout?.with?.ref, '${{ github.sha }}');
};

const assertJobUsesSetupEnv = (workflow, jobName) => {
  const setupEnvironment = workflow.jobs[jobName].steps.find(
    (step) => step.uses === './.github/actions/setup-env',
  );

  assert.ok(setupEnvironment, `${jobName} must install Bun through the shared setup action`);
  assert.equal(setupEnvironment.with?.['node-version'], '${{ env.NODEJS_VERSION }}');
  assert.equal(setupEnvironment.with?.['package-manager-cache'], false);
};

test('build workflow publishes images without production access', () => {
  const { source, workflow } = loadWorkflow('comhub-build.yml');

  assert.ok(workflow.on.push);
  assert.ok(workflow.on.workflow_dispatch);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.ok(Object.values(workflow.jobs).every((job) => job.environment !== 'production'));
  assert.equal((source.match(/docker\/build-push-action@v7/gu) ?? []).length, 3);
  assert.match(source, /git show -s --format=%cI/);
  assert.doesNotMatch(source, /COMHUB_SSH_PRIVATE_KEY/);
  assert.doesNotMatch(source, /comhub-production-deploy/);
});

test('Module App verification jobs install Bun through the shared setup action', () => {
  const setupEnvironment = readRepositoryFile('.github/actions/setup-env/action.yml');
  assert.match(setupEnvironment, /oven-sh\/setup-bun@v2/u);

  for (const [filename, jobNames] of [
    ['comhub-build.yml', ['verify-module-app']],
    ['comhub-deploy-worker.yml', ['verify-worker']],
  ]) {
    const { workflow } = loadWorkflow(filename);
    for (const jobName of jobNames) assertJobUsesSetupEnv(workflow, jobName);
  }
});

test('Module App business provider configuration stays in the application backend', () => {
  for (const filename of ['comhub-build.yml', 'comhub-deploy.yml']) {
    const { source, workflow } = loadWorkflow(filename);

    assert.equal(workflow.on.workflow_dispatch.inputs.verify_module_app_full, undefined);
    assert.equal(workflow.jobs['verify-module-app-full'], undefined);
    assert.doesNotMatch(source, /environment:\s*module-app-staging/u);
    assert.doesNotMatch(source, /\$\{\{\s*(?:secrets|vars)\.MODULE_APP_/u);
    assert.doesNotMatch(source, /MODULE_APP_E2E_/u);
  }

  const { source, workflow } = loadWorkflow('comhub-deploy.yml');
  assert.equal(workflow.on.workflow_dispatch.inputs.deploy_module_runtime.default, 'false');
  assert.match(
    source,
    /REQUIRE_MODULE_RUNTIME: \$\{\{ inputs\.deploy_module_runtime == 'true' \}\}/u,
  );
});

test('Module App SDK workspace installs link source instead of unpublished build output', () => {
  const manifest = JSON.parse(readRepositoryFile('packages/module-app-sdk/package.json'));

  assert.equal(manifest.publishConfig.directory, 'dist');
  assert.equal(manifest.publishConfig.linkDirectory, false);
});

test('PR checks validate main-bound changes without deployment capability', () => {
  const { source, workflow } = loadWorkflow('comhub-pr-check.yml');

  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.deepEqual(Object.keys(workflow.jobs), ['verify']);
  assert.equal(workflow.jobs.verify.environment, undefined);
  assert.match(source, /node --test .github\/workflows\/comhubDeploymentWorkflows\.test\.mjs/);
  assert.match(source, /pnpm type-check/);
  assert.doesNotMatch(source, /cache: pnpm/);
  assert.doesNotMatch(source, /docker\/build-push-action/);
  assert.doesNotMatch(source, /COMHUB_SSH_PRIVATE_KEY/);
  assert.doesNotMatch(source, /MODULE_APP_ALIPAY_/);
  assert.doesNotMatch(source, /deploy_module_worker/);
});

test('main deployment is manual and reuses existing digest images', () => {
  const { source, workflow } = loadWorkflow('comhub-deploy.yml');

  assertManualOnly(workflow);
  assert.ok(workflow.on.workflow_dispatch.inputs.source_sha);
  assert.doesNotMatch(source, /docker\/build-push-action/);
  assert.doesNotMatch(source, /deploy_module_worker/);
  assert.match(source, /resolveImageReference\.mjs/);
  assert.match(source, /git merge-base --is-ancestor/);
  assert.match(source, /COMHUB_SSH_KNOWN_HOSTS/);
  assert.doesNotMatch(source, /ssh-keyscan/);
  assertPinnedMainTooling(source, workflow, 'resolve-images');
  assertProductionLock(workflow.jobs.deploy);
});

test('production ParadeDB manifest pins the image and preserves the server contract', () => {
  const source = readRepositoryFile('docker-compose/deploy/paradedb/compose.yml');
  const compose = parse(source);
  const service = compose.services.paradedb;

  assert.equal(compose.name, 'paradedb');
  assert.deepEqual(Object.keys(compose.services), ['paradedb']);
  assert.equal(
    service.image,
    'paradedb/paradedb@sha256:0606ed798dd5ecda1ddec002f36dd807c3342b269b57ce14cad7eb2033bbb344',
  );
  assert.equal(service.container_name, 'comhub-paradedb');
  assert.equal(service.restart, 'always');
  assert.deepEqual(service.env_file, ['.env']);
  assert.deepEqual(service.environment, {
    POSTGRES_DB: '${POSTGRES_DB}',
    POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
    POSTGRES_USER: '${POSTGRES_USER}',
  });
  assert.deepEqual(service.ports, ['127.0.0.1:${HOST_PORT:-15432}:5432']);
  assert.deepEqual(service.volumes, ['./data:/var/lib/postgresql']);
  assert.deepEqual(service.logging, {
    driver: 'json-file',
    options: { 'max-file': '5', 'max-size': '20m' },
  });
  assert.doesNotMatch(source, /paradedb\/paradedb:latest/u);
});

test('main deployment relays immutable OCI images before the remote traffic switch', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const steps = workflow.jobs.deploy.steps;
  const relayIndex = steps.findIndex(
    (step) => step.name === 'Relay immutable images to production',
  );
  const deployIndex = steps.findIndex((step) => step.name === 'Run remote blue-green deploy');
  const relay = steps[relayIndex];
  const remoteDeploy = steps[deployIndex];

  assert.ok(relayIndex >= 0, 'expected an OCI image relay step');
  assert.ok(deployIndex > relayIndex, 'image relay must finish before the remote traffic switch');
  assert.match(relay?.run ?? '', /skopeo copy[\s\S]*--all[\s\S]*--preserve-digests/u);
  assert.match(relay?.run ?? '', /oci-archive:/u);
  assert.match(relay?.run ?? '', /ctr -n moby images import --all-platforms/u);
  assert.match(relay?.run ?? '', /docker image prune -af/u);
  assert.match(relay?.run ?? '', /ctr -n moby images pull --platform linux\/amd64/u);
  assert.doesNotMatch(
    remoteDeploy?.run ?? '',
    /COMHUB_CTR_PULL_TIMEOUT|Pre-pulling image through containerd/u,
  );
});

test('main deployment isolates remote Compose exec commands from the SSH script input', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const composeExecLines = (remoteDeploy?.run ?? '')
    .split('\n')
    .filter((line) => line.includes('docker compose exec -T'));

  assert.ok(composeExecLines.length > 0, 'expected remote Compose exec commands');
  for (const line of composeExecLines) {
    assert.match(
      line,
      /<\s*\/dev\/null/u,
      `remote Compose exec must not consume the remaining SSH here-doc: ${line.trim()}`,
    );
  }
});

test('closed deployment skips the optional Module Runtime rollout', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const script = remoteDeploy?.run ?? '';
  const preflightIndex = script.indexOf(
    'verify_module_runtime "$previous_runtime_image" "preflight"',
  );
  const rolloutGuardIndex = script.lastIndexOf(
    'if [ "$REQUIRE_MODULE_RUNTIME" = "true" ]; then',
    preflightIndex,
  );
  const authProbeIndex = script.indexOf('verify_runtime_auth_boundary', preflightIndex);
  const skipIndex = script.indexOf(
    'echo "module-runtime rollout skipped; production mutation flags remain disabled"',
    authProbeIndex,
  );

  assert.ok(rolloutGuardIndex >= 0, 'expected a guarded Module Runtime rollout');
  assert.ok(preflightIndex > rolloutGuardIndex, 'Runtime preflight must stay inside the guard');
  assert.ok(authProbeIndex > preflightIndex, 'Runtime auth probe must stay inside the guard');
  assert.ok(skipIndex > authProbeIndex, 'closed deployment must retain an explicit skip branch');
  assert.doesNotMatch(
    script,
    /if \[ "\$module_runtime_configured" = "true" \]; then\s+docker pull/u,
  );
});

test('application deployment preflights and rolls back a failed replacement', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const script = remoteDeploy?.run ?? '';
  const preflightIndex = script.indexOf(
    'verify_application "$previous_app_image" "$previous_app_tag" "preflight"',
  );
  const trapIndex = script.indexOf('trap rollback_deployment ERR EXIT', preflightIndex);
  const rolloutStartIndex = script.indexOf('application_rollout_started=true', trapIndex);
  const replaceIndex = script.indexOf(
    'deploy_application "$IMAGE_REF" "$IMAGE_TAG"',
    rolloutStartIndex,
  );

  assert.ok(preflightIndex >= 0, 'expected the existing application to be preflighted');
  assert.ok(trapIndex > preflightIndex, 'application rollback must be armed after preflight');
  assert.ok(
    rolloutStartIndex > trapIndex,
    'application rollout must not start before its rollback trap is installed',
  );
  assert.ok(replaceIndex > rolloutStartIndex, 'application replacement must follow rollout start');
  assert.match(script, /previous_app_id="\$\(docker compose ps -q "\$app_service"\)"/u);
  assert.match(
    script,
    /previous_app_image="\$\(docker inspect -f '\{\{\.Config\.Image\}\}' "\$previous_app_id"\)"/u,
  );
  assert.match(
    script,
    /previous_app_tag="\$\(docker inspect -f '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' "\$previous_app_id" \| sed -n 's\/\^COMHUB_IMAGE_TAG=\/\/p'\)"/u,
  );
  assert.match(
    script,
    /deploy_application "\$previous_app_image" "\$previous_app_tag"[\s\S]*?verify_application "\$previous_app_image" "\$previous_app_tag" "rollback"/u,
  );
  assert.match(script, /application_rollout_committed=true/u);
  assert.match(script, /APPLICATION_ROLLBACK_(COMPLETED|FAILED)/u);

  const rollbackFunction = script.slice(
    script.indexOf('rollback_deployment() {'),
    script.indexOf('verify_runtime_auth_boundary() {'),
  );
  const prematureExitRollback = spawnSync('bash', [], {
    encoding: 'utf8',
    input: `deploy_application() { printf 'deploy:%s:%s\\n' "$1" "$2"; }
verify_application() { printf 'verify:%s:%s:%s\\n' "$1" "$2" "$3"; }
REQUIRE_MODULE_RUNTIME=false
application_rollout_started=true
application_rollout_committed=false
previous_app_image=old-image
previous_app_tag=sha-0123456789ab
runtime_rollout_started=false
runtime_rollout_committed=false
${rollbackFunction}
trap rollback_deployment ERR EXIT
exit 0`,
  });
  assert.equal(
    prematureExitRollback.status,
    1,
    `premature application EXIT rollback failed:\nstdout:\n${prematureExitRollback.stdout}\nstderr:\n${prematureExitRollback.stderr}`,
  );
  assert.match(prematureExitRollback.stdout, /deploy:old-image:sha-0123456789ab/u);
  assert.match(prematureExitRollback.stdout, /verify:old-image:sha-0123456789ab:rollback/u);
  assert.match(prematureExitRollback.stdout, /APPLICATION_ROLLBACK_COMPLETED/u);
  assert.doesNotMatch(prematureExitRollback.stderr, /APPLICATION_ROLLBACK_FAILED/u);

  const applicationHelpers = script.slice(
    script.indexOf('application_verify_failed() {'),
    script.indexOf('runtime_verify_failed() {'),
  );
  const delayedHealthyApplication = spawnSync('bash', [], {
    encoding: 'utf8',
    input: `set -euo pipefail
health_attempt_file="$(mktemp)"
trap 'rm -f "$health_attempt_file"' EXIT
printf '0' > "$health_attempt_file"
docker() {
  if [ "$1" = compose ] && [ "$2" = ps ]; then
    printf 'app-id\\n'
    return
  fi
  if [ "$1" = inspect ] && [ "$2" = -f ]; then
    case "$3" in
      *Config.Image*) printf 'new-image\\n' ;;
      *Config.Env*) printf 'COMHUB_IMAGE_TAG=sha-0123456789ab\\n' ;;
      *State.Health*)
        attempt="$(cat "$health_attempt_file")"
        attempt=$((attempt + 1))
        printf '%s' "$attempt" > "$health_attempt_file"
        if [ "$attempt" -lt 3 ]; then printf 'starting\\n'; else printf 'healthy\\n'; fi
        ;;
    esac
    return
  fi
  return 1
}
sleep() { :; }
app_service=comhub
${applicationHelpers}
verify_application new-image sha-0123456789ab rollout
test "$(cat "$health_attempt_file")" -eq 3`,
  });
  assert.equal(
    delayedHealthyApplication.status,
    0,
    `application health wait failed:\nstdout:\n${delayedHealthyApplication.stdout}\nstderr:\n${delayedHealthyApplication.stderr}`,
  );
  assert.match(delayedHealthyApplication.stdout, /APPLICATION_VERIFY_PASSED: phase=rollout/u);
});

test('Module Runtime deployment preflights topology and rolls back a failed replacement', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const script = remoteDeploy?.run ?? '';
  const preflightIndex = script.indexOf(
    'verify_module_runtime "$previous_runtime_image" "preflight"',
  );
  const pullIndex = script.indexOf('docker pull "$RUNTIME_IMAGE_REF"');
  const trapIndex = script.indexOf('trap rollback_deployment ERR EXIT', pullIndex);
  const rolloutStartIndex = script.indexOf('runtime_rollout_started=true', pullIndex);
  const replaceIndex = script.indexOf(
    'docker compose up -d --no-deps --wait module-runtime',
    pullIndex,
  );

  assert.ok(preflightIndex >= 0, 'expected the existing Runtime topology to be preflighted');
  assert.ok(pullIndex > preflightIndex, 'Runtime preflight must finish before image pull');
  assert.ok(trapIndex > pullIndex, 'Runtime rollback trap must be installed after the pull');
  assert.ok(
    rolloutStartIndex > trapIndex,
    'Runtime rollout must not be marked started before its rollback trap is installed',
  );
  assert.ok(
    replaceIndex > rolloutStartIndex,
    'Runtime replacement must happen after rollout starts',
  );
  assert.match(script, /previous_runtime_id="\$\(docker compose ps -q module-runtime\)"/u);
  assert.match(
    script,
    /previous_runtime_image="\$\(docker inspect -f '\{\{\.Config\.Image\}\}' "\$previous_runtime_id"\)"/u,
  );
  assert.match(
    script,
    /\[\[ "\$previous_runtime_image" =~ \^\[\^\[:space:\]@\]\+@sha256:\[0-9a-f\]\{64\}\$ \]\] \|\| runtime_verify_failed "preflight" previous_image_not_immutable/u,
  );
  assert.match(script, /trap rollback_deployment ERR EXIT/u);
  assert.match(
    script,
    /export COMHUB_MODULE_RUNTIME_IMAGE="\$previous_runtime_image"[\s\S]*?docker compose up -d --no-deps --wait module-runtime[\s\S]*?verify_module_runtime "\$previous_runtime_image" "rollback"/u,
  );
  assert.match(script, /runtime_rollout_committed=true/u);
  assert.match(script, /MODULE_RUNTIME_VERIFY_FAILED:/u);
  assert.match(script, /MODULE_RUNTIME_ROLLBACK_(COMPLETED|FAILED)/u);

  const verifyFunction = script.slice(
    script.indexOf('verify_module_runtime() {'),
    script.indexOf('rollback_deployment() {'),
  );
  const explicitFailureReturns = [
    ...verifyFunction.matchAll(/runtime_verify_failed "\$phase" ([a-z0-9_]+)\s+return 1/gu),
  ].map((match) => match[1]);
  assert.deepEqual(explicitFailureReturns, [
    'expected_image_missing',
    'container_missing',
    'image_mismatch',
    'user_mismatch',
    'writable_rootfs',
    'no_new_privileges_missing',
    'artifact_mount_not_read_only',
    'artifact_source_missing',
    'artifact_root_mismatch',
    'docker_host_invalid',
    'rootless_socket_mount_invalid',
    'host_docker_socket_exposed',
    'rootless_socket_unavailable',
    'daemon_not_rootless',
    'readiness_failed',
    'disabled_invocation_boundary_failed',
  ]);

  const runtimeHelpers = script.slice(
    script.indexOf('runtime_verify_failed() {'),
    script.indexOf('rollback_deployment() {'),
  );
  const missingExpectedImage = spawnSync('bash', [], {
    encoding: 'utf8',
    input: `${runtimeHelpers}\nset +e\nverify_module_runtime "" rollback`,
  });
  assert.equal(missingExpectedImage.status, 1);
  assert.match(
    missingExpectedImage.stderr,
    /MODULE_RUNTIME_VERIFY_FAILED: phase=rollback check=expected_image_missing/u,
  );
  assert.doesNotMatch(missingExpectedImage.stdout, /MODULE_RUNTIME_VERIFY_PASSED/u);

  const rollbackFunction = script.slice(
    script.indexOf('rollback_deployment() {'),
    script.indexOf('verify_runtime_auth_boundary() {'),
  );
  assert.match(
    rollbackFunction,
    /if \[ "\$failure_status" -eq 0 \]; then\s+failure_status=1\s+fi/u,
  );
  const prematureExitRollback = spawnSync('bash', [], {
    encoding: 'utf8',
    input: `docker() { printf 'docker:%s\\n' "$*"; }
verify_module_runtime() { printf 'verify:%s:%s\\n' "$1" "$2"; }
REQUIRE_MODULE_RUNTIME=true
application_rollout_started=false
application_rollout_committed=false
runtime_rollout_started=true
runtime_rollout_committed=false
previous_runtime_image=old-image
${rollbackFunction}
trap rollback_deployment ERR EXIT
exit 0`,
  });
  assert.equal(
    prematureExitRollback.status,
    1,
    `premature EXIT rollback failed:\nstdout:\n${prematureExitRollback.stdout}\nstderr:\n${prematureExitRollback.stderr}`,
  );
  assert.equal(prematureExitRollback.stdout.match(/MODULE_RUNTIME_ROLLBACK_STARTED/gu)?.length, 1);
  assert.match(prematureExitRollback.stdout, /verify:old-image:rollback/u);
  assert.match(prematureExitRollback.stdout, /MODULE_RUNTIME_ROLLBACK_COMPLETED/u);
  assert.doesNotMatch(prematureExitRollback.stderr, /MODULE_RUNTIME_ROLLBACK_FAILED/u);
});

test('production deployment keeps public Module App execution closed unconditionally', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const script = remoteDeploy?.run ?? '';

  assert.match(
    script,
    /if \[ "\$public_execution" = "true" \]; then\s+echo "Public Module App launch must remain disabled until the remaining production gates pass"\s+exit 1\s+fi/u,
  );
  assert.doesNotMatch(script, /Public Module App launch requires an HTTPS runtime origin/u);
  assert.doesNotMatch(script, /Public Module App launch requires a non-empty app allowlist/u);
});

test('Module Runtime auth probe reports operational failure reasons', () => {
  const { workflow } = loadWorkflow('comhub-deploy.yml');
  const remoteDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Run remote blue-green deploy',
  );
  const script = remoteDeploy?.run ?? '';
  const authProbeFunction = script.slice(
    script.indexOf('verify_runtime_auth_boundary() {'),
    script.indexOf('echo "Disk usage before deploy:"'),
  );

  for (const check of [
    'container_start',
    'health_inspect',
    'health',
    'unauthorized_boundary',
    'cleanup',
  ]) {
    assert.match(authProbeFunction, new RegExp(`check=${check}(?:[ '\\n]|$)`, 'u'));
  }
});

test('Worker deployment is manual, targeted, and build-free', () => {
  const { source, workflow } = loadWorkflow('comhub-deploy-worker.yml');

  assertManualOnly(workflow);
  assert.ok(workflow.on.workflow_dispatch.inputs.source_sha);
  assert.doesNotMatch(source, /docker\/build-push-action/);
  assert.doesNotMatch(source, /Deploy Production/);
  assert.match(source, /pnpm install --no-frozen-lockfile/);
  assert.doesNotMatch(source, /pnpm install --frozen-lockfile/);
  assert.match(source, /pnpm verify:module-app-worker/);
  assert.match(source, /node docker-compose\/deploy\/module-worker\/compose\.test\.mjs/);
  assert.match(source, /resolveImageReference\.mjs/);
  assert.match(source, /COMHUB_SSH_KNOWN_HOSTS/);
  assert.match(source, /SOURCE_SHA/);
  assertPinnedMainTooling(source, workflow, 'deploy');
  assertProductionLock(workflow.jobs.deploy);

  const workerDeploy = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Deploy independent Module App worker',
  );
  assert.match(
    workerDeploy?.run ?? '',
    /if \[ "\$untracked_worker_health" = unhealthy \]; then[\s\S]*?rm --force --stop module-app-worker/,
  );
  assert.match(
    workerDeploy?.run ?? '',
    /if should_remove_failed_clean_host_worker[\s\S]*?"\$untracked_worker_preserved"; then[\s\S]*?rm --force --stop module-app-worker/,
  );

  const cleanupPredicate = (workerDeploy?.run ?? '').match(
    /^should_remove_failed_clean_host_worker\(\) \{\n[\s\S]*?^\}/mu,
  )?.[0];
  assert.ok(cleanupPredicate, 'Worker deployment must define a clean-host cleanup predicate');

  for (const scenario of [
    {
      expected: 0,
      preserved: 'false',
      previousImage: 'false',
      previousTargetPresent: 'false',
    },
    {
      expected: 1,
      preserved: 'false',
      previousImage: 'true',
      previousTargetPresent: 'false',
    },
    {
      expected: 1,
      preserved: 'false',
      previousImage: 'false',
      previousTargetPresent: 'true',
    },
    {
      expected: 1,
      preserved: 'true',
      previousImage: 'false',
      previousTargetPresent: 'false',
    },
  ]) {
    const result = spawnSync('bash', [], {
      encoding: 'utf8',
      input: `${cleanupPredicate}\nshould_remove_failed_clean_host_worker '${scenario.previousImage}' '${scenario.previousTargetPresent}' '${scenario.preserved}'`,
    });
    assert.equal(
      result.status,
      scenario.expected,
      `unexpected cleanup decision for ${JSON.stringify(scenario)}: ${result.stderr}`,
    );
  }

  const failedDeployDiagnostics = workflow.jobs.deploy.steps.find(
    (step) => step.name === 'Diagnose failed Worker deployment',
  );
  assert.equal(failedDeployDiagnostics?.if, '${{ failure() }}');
  assert.match(failedDeployDiagnostics?.run ?? '', /\.State\.Health\.Log/);
  assert.match(
    failedDeployDiagnostics?.run ?? '',
    /label=com\.docker\.compose\.project=comhub-module-worker/,
  );
  assert.match(failedDeployDiagnostics?.run ?? '', /health-file=/);
  assert.match(failedDeployDiagnostics?.run ?? '', /artifact-root=/);
  assert.match(failedDeployDiagnostics?.run ?? '', /database-tcp=/);
  assert.doesNotMatch(failedDeployDiagnostics?.run ?? '', /\.Config\.Env|printenv/);
});

test('Worker deployment relays immutable prerequisites after pruning and before deploy', () => {
  const { workflow } = loadWorkflow('comhub-deploy-worker.yml');
  const steps = workflow.jobs.deploy.steps;
  const loginIndex = steps.findIndex(
    (step) => step.name === 'Login to GHCR for production image relay',
  );
  const toolingIndex = steps.findIndex((step) => step.name === 'Install OCI relay tooling');
  const relayIndex = steps.findIndex(
    (step) => step.name === 'Relay Worker prerequisites to production',
  );
  const deployIndex = steps.findIndex(
    (step) => step.name === 'Deploy independent Module App worker',
  );
  const relay = steps[relayIndex];
  const workerDeploy = steps[deployIndex];
  const relayScript = relay?.run ?? '';
  const deployScript = workerDeploy?.run ?? '';
  const relayPruneIndex = relayScript.indexOf('docker image prune -af');
  const relaySetupIndex = relayScript.indexOf('worker_repository=');
  const workerDeployCommandIndex = deployScript.indexOf(
    '"$worker_deploy_dir/current/deploy.sh" "$worker_image_ref"',
  );

  assert.equal(
    workflow.env.POSTGRES_PROBE_IMAGE_REF,
    'docker.io/library/postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193',
  );
  assert.equal(workflow.env.POSTGRES_PROBE_IMAGE_TAG, 'docker.io/library/postgres:17-alpine');
  assert.ok(relayIndex >= 0, 'expected a Worker prerequisite relay step');
  assert.ok(loginIndex >= 0 && loginIndex < relayIndex, 'GHCR login must precede image relay');
  assert.ok(
    toolingIndex >= 0 && toolingIndex < relayIndex,
    'relay tooling must be installed first',
  );
  assert.ok(deployIndex > relayIndex, 'Worker prerequisites must be relayed before deployment');
  assert.ok(relaySetupIndex >= 0, 'expected Worker relay reference setup');
  assert.ok(
    relayPruneIndex >= 0 && relayPruneIndex < relaySetupIndex,
    'remote image pruning must finish before the first relay is prepared',
  );
  assert.match(relayScript, /local -a copy_options=\(--all --preserve-digests\)/u);
  assert.match(relayScript, /oci-archive:/u);
  assert.match(relayScript, /ctr -n moby images import --all-platforms/u);
  assert.match(relayScript, /\^ghcr\\\.io\/\[a-z0-9\._\/-\]\+@sha256:\[0-9a-f\]\{64\}\$/u);
  assert.match(relayScript, /\^docker\\\.io\/library\/postgres@sha256:\[0-9a-f\]\{64\}\$/u);
  assert.match(relayScript, /ctr -n moby images pull --platform linux\/amd64/u);
  assert.match(
    relayScript,
    /docker image inspect '\$WORKER_IMAGE_REF' '\$POSTGRES_PROBE_IMAGE_TAG'/u,
  );
  assert.ok(workerDeployCommandIndex >= 0, 'expected the promoted Worker release to execute');
  assert.equal(
    deployScript.lastIndexOf('docker image prune -af', workerDeployCommandIndex),
    -1,
    'the remote deployment must not prune relayed images before Worker startup',
  );
  assert.ok(
    deployScript.indexOf('docker image prune -af', workerDeployCommandIndex) >
      workerDeployCommandIndex,
    'the remote deployment must retain post-deploy image cleanup',
  );
});

test('main deployment smoke covers version, brand assets, and public entry points', () => {
  const { source } = loadWorkflow('comhub-deploy.yml');

  const smokeStart = source.indexOf("done <<'SMOKE_CHECKS'");
  const smokeEnd = source.indexOf('\n          SMOKE_CHECKS', smokeStart);
  const smokeBlock =
    smokeStart >= 0 && smokeEnd > smokeStart
      ? source.slice(smokeStart + "done <<'SMOKE_CHECKS'\n".length, smokeEnd)
      : undefined;
  assert.ok(smokeBlock, 'post-deploy smoke checks must declare an explicit status table');

  assert.deepEqual(
    smokeBlock
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/u)),
    [
      ['/', '302'],
      ['/api/auth/get-session', '200'],
      ['/api/version', '200'],
      ['/favicon.ico', '200'],
      ['/images/brand/xuanguo-loading.svg', '200'],
      ['/signin', '200'],
    ],
  );

  assert.match(source, /if \[ "\$code" != "\$expected" \]; then/u);
  assert.doesNotMatch(source, /\/branding\/loading\.svg/u);

  assert.match(source, /Version evidence:/u);
  assert.ok(source.includes('grep -q "${IMAGE_TAG}"'));
});

test('deployment workflows never trigger from push', () => {
  for (const filename of ['comhub-deploy.yml', 'comhub-deploy-worker.yml']) {
    const { workflow } = loadWorkflow(filename);
    assert.equal(workflow.on.push, undefined, `${filename} must not deploy from push`);
  }
});

test('GitHub automation is valid YAML and does not use deprecated Node 20 actions', () => {
  for (const filename of collectYamlFiles(path.join(repositoryRoot, '.github'))) {
    const source = readFileSync(filename, 'utf8');
    assert.doesNotThrow(
      () => parse(source),
      `${path.relative(repositoryRoot, filename)} is invalid YAML`,
    );
    assert.doesNotMatch(
      source,
      /actions\/checkout@v4|actions\/setup-node@v4|pnpm\/action-setup@v4|docker\/(?:login-action|setup-buildx-action)@v3|docker\/build-push-action@v6/u,
      `${path.relative(repositoryRoot, filename)} still references a Node 20 action`,
    );
  }
});

test('ComHub build tooling uses Node 24 LTS while preserving the node22 module contract', () => {
  const nodeVersion = '24.18.0';

  assert.match(
    readRepositoryFile('Dockerfile'),
    new RegExp(`NODEJS_VERSION="${nodeVersion}"`, 'u'),
  );
  assert.match(
    readRepositoryFile('scripts/deploy/comhub-build-package.ps1'),
    new RegExp(`NodeVersion = '${nodeVersion}'`, 'u'),
  );

  for (const filename of [
    '.agents/resume',
    '.agents/setup',
    '.github/actions/setup-env/action.yml',
  ]) {
    assert.match(readRepositoryFile(filename), new RegExp(nodeVersion.replaceAll('.', '\\.'), 'u'));
  }

  for (const filename of [
    '.github/workflows/comhub-build.yml',
    '.github/workflows/comhub-deploy-worker.yml',
    '.github/workflows/comhub-deploy.yml',
    '.github/workflows/comhub-desktop-release.yml',
    '.github/workflows/comhub-pr-check.yml',
    '.github/workflows/comhub-upstream-sync.yml',
  ]) {
    const source = readRepositoryFile(filename);
    assert.match(source, new RegExp(nodeVersion.replaceAll('.', '\\.'), 'u'));
    const setupNodeCount = (
      source.match(/uses: (?:actions\/setup-node@v6|\.\/\.github\/actions\/setup-env)/gu) ?? []
    ).length;
    const disabledCacheCount = (source.match(/package-manager-cache: false/gu) ?? []).length;
    assert.equal(disabledCacheCount, setupNodeCount);
  }

  for (const filename of ['apps/module-runtime/Dockerfile', 'apps/module-worker/Dockerfile']) {
    const source = readRepositoryFile(filename);
    assert.match(
      source,
      new RegExp(`node:${nodeVersion.replaceAll('.', '\\.')}-alpine3\\.23`, 'u'),
    );
    assert.match(source, /--target=node24/u);
  }

  const composeSource = readRepositoryFile('docker-compose/deploy/module-runtime.yml');
  assert.doesNotMatch(composeSource, /\/var\/run\/docker\.sock/u);
  assert.match(
    composeSource,
    /MODULE_APP_RUNTIME_ROOTLESS_DOCKER_SOCKET:\?dedicated rootless Docker socket required/u,
  );
  assert.match(
    composeSource,
    /MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT:\?daemon-visible artifact root required/u,
  );
  assert.match(composeSource, /DOCKER_HOST: 'unix:\/\/\/run\/module-app-docker\/docker\.sock'/u);
  assert.match(composeSource, /127\.0\.0\.1:3210\/ready/u);
  assert.match(readRepositoryFile('apps/module-runtime/Dockerfile'), /127\.0\.0\.1:3210\/ready/u);
  const deploymentSource = readRepositoryFile('.github/workflows/comhub-deploy.yml');
  assert.match(deploymentSource, /test "\$docker_artifact_root" = "\$artifact_source"/u);
  assert.match(deploymentSource, /test "\$docker_socket_mount" = 'bind\|false'/u);
  assert.match(deploymentSource, /docker info --format.*name=rootless/u);
  assert.match(deploymentSource, /--health-cmd .*127\.0\.0\.1:3210\/health/u);
  assert.match(deploymentSource, /MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT=\/runtime\/artifacts/u);
  assert.doesNotMatch(deploymentSource, /MODULE_APP_RUNTIME_JWKS=\{"keys":\[\]\}/u);
  assert.match(deploymentSource, /MODULE_APP_RUNTIME_JWKS=.*"kty":"RSA".*"alg":"RS256"/u);
  assert.equal(
    (
      composeSource.match(
        new RegExp(`node:${nodeVersion.replaceAll('.', '\\.')}-alpine3\\.23`, 'gu'),
      ) ?? []
    ).length,
    2,
  );

  assert.match(
    readRepositoryFile('apps/module-runtime/docker/Dockerfile.node22'),
    /FROM node:22\.22\.0-alpine3\.23/u,
  );
  assert.match(
    readRepositoryFile('packages/types/src/moduleAppRuntime.ts'),
    /z\.enum\(\['node22', 'python312'\]\)/u,
  );
});

test('all workflow Bash run blocks pass syntax validation', () => {
  for (const filename of ['comhub-build.yml', 'comhub-deploy.yml', 'comhub-deploy-worker.yml']) {
    const { workflow } = loadWorkflow(filename);
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const [stepIndex, step] of (job.steps ?? []).entries()) {
        if (typeof step.run !== 'string' || step.shell === 'pwsh') continue;
        const result = spawnSync('bash', ['-n'], { encoding: 'utf8', input: step.run });
        assert.equal(
          result.status,
          0,
          `${filename} ${jobName} step ${stepIndex + 1} has invalid Bash:\n${result.stderr}`,
        );
      }
    }
  }
});
