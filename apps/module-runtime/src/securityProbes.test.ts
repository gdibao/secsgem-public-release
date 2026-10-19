// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DockerCliModuleAppContainerEngine } from './containerEngine';
import { ContainerModuleAppLauncher } from './invocation';

const realContainerEnabled = process.env.MODULE_APP_REAL_CONTAINER_TESTS === 'true';
const productionGatesRequired = process.env.MODULE_APP_PRODUCTION_GATES_REQUIRED === 'true';

if (productionGatesRequired && !realContainerEnabled) {
  throw new Error('MODULE_APP_REAL_CONTAINER_TESTS_REQUIRED');
}

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const dockerContainerExists = (
  containerName: string,
  inspect: (...args: string[]) => string = docker,
) => {
  try {
    inspect('inspect', containerName);
    return true;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error);
    if (/no such (?:object|container)/i.test(stderr)) return false;
    throw error;
  }
};

const waitForStableContainerAbsence = async (containerName: string) => {
  const deadline = Date.now() + 5000;
  let absentSince: number | undefined;

  while (Date.now() < deadline) {
    const exists = dockerContainerExists(containerName);

    if (exists) {
      absentSince = undefined;
    } else {
      absentSince ??= Date.now();
      if (Date.now() - absentSince >= 1500) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`MODULE_APP_PROBE_CONTAINER_LEAKED:${containerName}`);
};

describe('Docker container probe classification', () => {
  it('accepts only an explicit missing-container response as absence', () => {
    const missing = Object.assign(new Error('missing'), {
      stderr: 'error: no such object: module-app-probe-missing',
    });
    expect(
      dockerContainerExists('module-app-probe-missing', () => {
        throw missing;
      }),
    ).toBe(false);

    const unavailable = Object.assign(new Error('daemon unavailable'), {
      stderr: 'Cannot connect to the Docker daemon',
    });
    expect(() =>
      dockerContainerExists('module-app-probe-unknown', () => {
        throw unavailable;
      }),
    ).toThrow('daemon unavailable');
  });
});

const writeFixture = (directory: string, name: string, source: string) => {
  writeFileSync(path.join(directory, name), source, 'utf8');
  return name;
};

describe.skipIf(!realContainerEnabled)('Module App real container security probes', () => {
  const artifactRoot = mkdtempSync(path.join(tmpdir(), 'module-app-security-'));
  const nodeArtifacts = path.join(artifactRoot, 'node');
  const pythonArtifacts = path.join(artifactRoot, 'python');
  let nodeImage: string;
  let pythonImage: string;

  beforeAll(() => {
    docker('info', '--format', '{{.ServerVersion}}');
    nodeImage = docker(
      'build',
      '--quiet',
      '--file',
      path.resolve('apps/module-runtime/docker/Dockerfile.node22'),
      path.resolve('apps/module-runtime/docker'),
    );
    pythonImage = docker(
      'build',
      '--quiet',
      '--file',
      path.resolve('apps/module-runtime/docker/Dockerfile.python312'),
      path.resolve('apps/module-runtime/docker'),
    );
    for (const directory of [nodeArtifacts, pythonArtifacts]) {
      require('node:fs').mkdirSync(directory, { recursive: true });
    }
  }, 300_000);

  afterAll(() => {
    rmSync(artifactRoot, { force: true, recursive: true });
  });

  const run = async (input: {
    directory?: string;
    entry: string;
    image?: string;
    limits?: Partial<{ cpu: number; memoryBytes: number; pids: number; timeoutMs: number }>;
    runtime?: 'node22' | 'python312';
  }) => {
    const containerName = `module-app-probe-${crypto.randomUUID()}`;
    const engine = new DockerCliModuleAppContainerEngine();
    return {
      containerName,
      result: await engine.run({
        artifactDirectory: input.directory ?? nodeArtifacts,
        containerName,
        entry: input.entry,
        imageDigest: input.image ?? nodeImage,
        input: { probe: true },
        limits: {
          cpu: input.limits?.cpu ?? 0.5,
          memoryBytes: input.limits?.memoryBytes ?? 128 * 1024 * 1024,
          pids: input.limits?.pids ?? 32,
          timeoutMs: input.limits?.timeoutMs ?? 15_000,
        },
        runtime: input.runtime ?? 'node22',
      }),
    };
  };

  it('runs fixed Node and Python fixtures as the non-root runtime user', async () => {
    const nodeEntry = writeFixture(
      nodeArtifacts,
      'node-success.js',
      `process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({runtime:'node22',uid:process.getuid()})));`,
    );
    const pythonEntry = writeFixture(
      pythonArtifacts,
      'python-success.py',
      `import json, os, sys\njson.load(sys.stdin)\nprint(json.dumps({'runtime':'python312','uid':os.getuid()}))\n`,
    );

    await expect(run({ entry: nodeEntry })).resolves.toMatchObject({
      result: { exitCode: 0, stdout: expect.stringContaining('"uid":10001') },
    });
    await expect(
      run({
        directory: pythonArtifacts,
        entry: pythonEntry,
        image: pythonImage,
        runtime: 'python312',
      }),
    ).resolves.toMatchObject({
      result: { exitCode: 0, stdout: expect.stringContaining('"uid": 10001') },
    });
  }, 60_000);

  it('reconciles an expired managed container through Docker labels', async () => {
    const containerName = `module-app-stale-${crypto.randomUUID()}`;
    docker(
      'create',
      '--rm',
      '--name',
      containerName,
      '--label',
      'comhub.module-app.runtime=true',
      '--label',
      'comhub.module-app.expires-at=1',
      nodeImage,
      '-e',
      'setInterval(()=>{},1000)',
    );

    try {
      await expect(
        new DockerCliModuleAppContainerEngine().reconcileStaleContainers(Date.now()),
      ).resolves.toEqual({ failed: 0, removed: 1 });
      expect(dockerContainerExists(containerName)).toBe(false);
    } finally {
      try {
        docker('rm', '--force', containerName);
      } catch {
        // The reconciler normally removes it before this fail-safe cleanup.
      }
    }
  }, 30_000);

  it('denies network and artifact writes while keeping bounded tmp storage writable', async () => {
    const entry = writeFixture(
      nodeArtifacts,
      'isolation.js',
      `(async()=>{ const fs=require('node:fs');
let artifactReadOnly=false, networkDenied=false, tmpWritable=false;
try { fs.writeFileSync('forbidden.txt','x'); } catch { artifactReadOnly=true; }
try { fs.writeFileSync('/tmp/allowed.txt','x'); tmpWritable=true; } catch {}
try { await fetch('http://1.1.1.1',{signal:AbortSignal.timeout(1500)}); } catch { networkDenied=true; }
console.log(JSON.stringify({artifactReadOnly,networkDenied,tmpWritable})); })();`,
    );

    const { result } = await run({ entry });
    expect(JSON.parse(result.stdout)).toEqual({
      artifactReadOnly: true,
      networkDenied: true,
      tmpWritable: true,
    });
  }, 30_000);

  it('enforces PID, memory, and CPU cgroup limits and rejects process exhaustion', async () => {
    const entry = writeFixture(
      nodeArtifacts,
      'limits.js',
      `(async()=>{ const fs=require('node:fs'); const {spawn}=require('node:child_process');
const read=(name)=>fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();
const children=[]; let rejected=0;
for(let i=0;i<40;i++){ try { const child=spawn('node',['-e','setTimeout(()=>{},5000)']); child.on('error',()=>rejected++); children.push(child); } catch { rejected++; } }
await new Promise(resolve=>setTimeout(resolve,1000));
for(const child of children) child.kill('SIGKILL');
console.log(JSON.stringify({cpu:read('cpu.max'),memory:read('memory.max'),pids:read('pids.max'),rejected})); })();`,
    );

    const { result } = await run({
      entry,
      limits: { cpu: 0.25, memoryBytes: 64 * 1024 * 1024, pids: 16, timeoutMs: 20_000 },
    });
    const limits = JSON.parse(result.stdout);
    expect(limits.cpu).toBe('25000 100000');
    expect(limits.memory).toBe(String(64 * 1024 * 1024));
    expect(limits.pids).toBe('16');
    expect(limits.rejected).toBeGreaterThan(0);
  }, 30_000);

  it('bounds a real log flood and treats malformed JSON output as no structured output', async () => {
    const floodEntry = writeFixture(
      nodeArtifacts,
      'log-flood.js',
      `process.stdout.write('o'.repeat(200000)); process.stderr.write('e'.repeat(200000));`,
    );
    const { result } = await run({ entry: floodEntry });
    expect(result.stdout).toHaveLength(65_536);
    expect(result.stderr).toHaveLength(65_536);

    const malformedEntry = writeFixture(
      nodeArtifacts,
      'malformed.js',
      `process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write('{invalid'));`,
    );
    const launcher = new ContainerModuleAppLauncher({
      artifactRoot,
      images: { node22: nodeImage, python312: pythonImage },
    });
    const artifactSha256 = 'node';
    await expect(
      launcher.invoke({
        artifactSha256,
        capability: 'probe-capability',
        entry: malformedEntry,
        input: {},
        invocationId: crypto.randomUUID(),
        runtime: 'node22',
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({ output: undefined, stdout: '{invalid' });
  }, 30_000);

  it('rejects path traversal before launch and force-cleans a timed-out container', async () => {
    const launcher = new ContainerModuleAppLauncher({
      artifactRoot,
      images: { node22: nodeImage, python312: pythonImage },
    });
    await expect(
      launcher.invoke({
        artifactSha256: 'node',
        capability: 'probe-capability',
        entry: '../outside.js',
        input: {},
        invocationId: crypto.randomUUID(),
        runtime: 'node22',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('MODULE_APP_RUNTIME_POLICY_DENIED');

    const timeoutEntry = writeFixture(nodeArtifacts, 'timeout.js', `setInterval(()=>{},1000);`);
    const containerName = `module-app-probe-${crypto.randomUUID()}`;
    const engine = new DockerCliModuleAppContainerEngine();
    await expect(
      engine.run({
        artifactDirectory: nodeArtifacts,
        containerName,
        entry: timeoutEntry,
        imageDigest: nodeImage,
        input: {},
        limits: { cpu: 0.25, memoryBytes: 64 * 1024 * 1024, pids: 16, timeoutMs: 500 },
        runtime: 'node22',
      }),
    ).rejects.toThrow('MODULE_APP_RUNTIME_TIMEOUT');
    await waitForStableContainerAbsence(containerName);
  }, 30_000);
});
