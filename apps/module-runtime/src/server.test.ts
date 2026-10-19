import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER,
  MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT,
  MODULE_APP_RUNTIME_READINESS_PROOF_HEADER,
} from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DockerCliModuleAppContainerEngine } from './containerEngine';
import { ModuleAppRuntimeInvoker } from './invocation';
import {
  checkModuleAppRuntimeReadiness,
  createModuleAppRuntimeServer,
  isModuleAppRuntimeMain,
  startModuleAppRuntimeServerFromEnv,
} from './server';

const createInvoker = () =>
  new ModuleAppRuntimeInvoker({
    launcher: { invoke: vi.fn() },
  });

const runtimePublicJwk = {
  alg: 'RS256',
  e: 'AQAB',
  kid: 'module-runtime-public-test',
  kty: 'RSA',
  n: 't0juSBx7vW85s4fkqPzJaPHOK5OI2qlJLfjSCo3FlYogbBP67V4VN5L_TRFxtaccpEI0B6dGjFFjmJaHmCU2kKPbi3-c76k0sxCwrL6yuGV0uUc4ZOij2fviiQKdxAMlCA3Ke3XkG-p1JNQCz08Ge0xV0CDicKRh_njO0e0J1cE0X_7GOFwmZtLsU9541C4b4Jj2IsUauOSQkFCARvPTexC4V6hMir7sIbb0f9GqQk2MA0CIdMD2fcl6Q6bVgBCxuU0Q2D0D91JYSZWN-AAuXjT7A8bXErjBEK0_MNEWP3HxJZYjRHMDO_zW_tR1FmRKbP65ZtKKh2HQqkP4CrSn3Q',
  use: 'sig',
};
const runtimePublicJwks = JSON.stringify({ keys: [runtimePublicJwk] });

const temporaryRoots: string[] = [];

const requestServer = (
  url: string,
  options: { body?: string; headers?: Record<string, string>; method?: string } = {},
) =>
  new Promise<{ body: string; headers: NodeJS.Dict<string | string[]>; status: number }>(
    (resolve, reject) => {
      const request = httpRequest(
        url,
        { headers: options.headers, method: options.method ?? 'GET' },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.once('end', () =>
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              headers: response.headers,
              status: response.statusCode ?? 0,
            }),
          );
        },
      );
      request.once('error', reject);
      request.end(options.body);
    },
  );

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('createModuleAppRuntimeServer', () => {
  it('exposes a secret-free health check without invocation authorization', async () => {
    const server = createModuleAppRuntimeServer({
      internalToken: 'internal-token',
      invoker: createInvoker(),
      runtimeJwks: '{"keys":[]}',
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const response = await requestServer(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
      expect(response.body).not.toContain('internal-token');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('proves readiness token possession without receiving the token', async () => {
    const server = createModuleAppRuntimeServer({
      internalToken: 'internal-token',
      invoker: createInvoker(),
      readinessCheck: vi.fn().mockResolvedValue(undefined),
      runtimeJwks: runtimePublicJwks,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
    const readyUrl = `http://127.0.0.1:${address.port}/ready`;

    try {
      const publicReadiness = await requestServer(readyUrl);
      expect(publicReadiness.status).toBe(200);
      expect(JSON.parse(publicReadiness.body)).toEqual({ status: 'ready' });
      expect(publicReadiness.headers[MODULE_APP_RUNTIME_READINESS_PROOF_HEADER]).toBeUndefined();

      const challenge = 'a'.repeat(32);
      const provedReadiness = await requestServer(readyUrl, {
        headers: { [MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER]: challenge },
      });
      const expectedProof = createHmac('sha256', 'internal-token')
        .update(MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT)
        .update('\0')
        .update(challenge)
        .digest('base64url');
      expect(provedReadiness.status).toBe(200);
      expect(JSON.parse(provedReadiness.body)).toEqual({ status: 'ready' });
      expect(provedReadiness.headers[MODULE_APP_RUNTIME_READINESS_PROOF_HEADER]).toBe(
        expectedProof,
      );
      expect(JSON.stringify(provedReadiness)).not.toContain('internal-token');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('keeps health available while invocation mutations are disabled', async () => {
    const launcher = { invoke: vi.fn() };
    const server = createModuleAppRuntimeServer({
      internalToken: '',
      invocationEnabled: false,
      invoker: new ModuleAppRuntimeInvoker({ launcher }),
      runtimeJwks: '',
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const health = await requestServer(`http://127.0.0.1:${address.port}/health`);
      expect(health.status).toBe(200);
      const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
      expect(readiness.status).toBe(200);
      expect(JSON.parse(readiness.body)).toEqual({ status: 'disabled' });
      const invocation = await requestServer(`http://127.0.0.1:${address.port}/v1/invocations`, {
        body: '{}',
        method: 'POST',
      });
      expect(invocation.status).toBe(503);
      expect(JSON.parse(invocation.body)).toEqual({
        error: 'MODULE_APP_RUNTIME_INVOCATION_DISABLED',
      });
      expect(launcher.invoke).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('starts a health-only server without runtime credentials or images when disabled', async () => {
    vi.useFakeTimers();
    const engine = new DockerCliModuleAppContainerEngine();
    const reconcile = vi
      .spyOn(engine, 'reconcileStaleContainers')
      .mockResolvedValue({ failed: 0, removed: 0 });
    const healthCheck = vi.spyOn(engine, 'healthCheck');
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'false');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'false');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', '');
    vi.stubEnv('MODULE_APP_RUNTIME_JWKS', '');
    vi.stubEnv('MODULE_APP_RUNTIME_NODE22_IMAGE', '');
    vi.stubEnv('MODULE_APP_RUNTIME_PYTHON312_IMAGE', '');
    vi.stubEnv('PORT', '0');

    let server: ReturnType<typeof startModuleAppRuntimeServerFromEnv> | undefined;
    try {
      server = startModuleAppRuntimeServerFromEnv({ engine, reconcileIntervalMs: 10_000 });
      await new Promise<void>((resolve) => server!.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

      const response = await requestServer(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
      const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
      expect(JSON.parse(readiness.body)).toEqual({ status: 'disabled' });
      expect(healthCheck).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reconcile).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
      if (server) {
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      reconcile.mockRestore();
      healthCheck.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not construct an invoker from a relative daemon artifact path', async () => {
    const engine = new DockerCliModuleAppContainerEngine();
    const reconcile = vi
      .spyOn(engine, 'reconcileStaleContainers')
      .mockResolvedValue({ failed: 0, removed: 0 });
    const healthCheck = vi.spyOn(engine, 'healthCheck');
    vi.stubEnv('MODULE_APP_EXECUTION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_INVOCATION_ENABLED', 'true');
    vi.stubEnv('MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT', 'runtime/artifacts');
    vi.stubEnv('MODULE_APP_RUNTIME_INTERNAL_TOKEN', 'internal-token');
    vi.stubEnv('MODULE_APP_RUNTIME_JWKS', runtimePublicJwks);
    vi.stubEnv('MODULE_APP_RUNTIME_NODE22_IMAGE', `sha256:${'a'.repeat(64)}`);
    vi.stubEnv('MODULE_APP_RUNTIME_PYTHON312_IMAGE', `sha256:${'b'.repeat(64)}`);
    vi.stubEnv('PORT', '0');

    let server: ReturnType<typeof startModuleAppRuntimeServerFromEnv> | undefined;
    try {
      server = startModuleAppRuntimeServerFromEnv({ engine });
      await new Promise<void>((resolve) => server!.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

      const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
      expect(readiness.status).toBe(503);
      expect(JSON.parse(readiness.body)).toEqual({
        code: 'MODULE_APP_RUNTIME_CONFIG_MISSING',
        status: 'unavailable',
      });
      const invocation = await requestServer(`http://127.0.0.1:${address.port}/v1/invocations`, {
        body: '{}',
        method: 'POST',
      });
      expect(invocation.status).toBe(503);
      expect(JSON.parse(invocation.body)).toEqual({
        error: 'MODULE_APP_RUNTIME_CONFIG_MISSING',
      });
      expect(healthCheck).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      if (server) {
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      reconcile.mockRestore();
      healthCheck.mockRestore();
    }
  });

  it.each([
    { caseName: 'missing internal token', internalToken: '', runtimeJwks: runtimePublicJwks },
    { caseName: 'missing JWKS', internalToken: 'internal-token', runtimeJwks: '' },
    {
      caseName: 'empty JWKS',
      internalToken: 'internal-token',
      runtimeJwks: '{"keys":[]}',
    },
    {
      caseName: 'malformed RSA key',
      internalToken: 'internal-token',
      runtimeJwks: '{"keys":[{"alg":"RS256","kty":"RSA"}]}',
    },
    {
      caseName: 'private RSA key material',
      internalToken: 'internal-token',
      runtimeJwks: JSON.stringify({ keys: [{ ...runtimePublicJwk, d: 'private-material' }] }),
    },
  ])(
    'reports incomplete runtime credentials without losing liveness: $caseName',
    async ({ internalToken, runtimeJwks }) => {
      const server = createModuleAppRuntimeServer({
        internalToken,
        invoker: createInvoker(),
        runtimeJwks,
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

      try {
        const health = await requestServer(`http://127.0.0.1:${address.port}/health`);
        expect(health.status).toBe(200);
        const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
        expect(readiness.status).toBe(503);
        expect(JSON.parse(readiness.body)).toEqual({
          code: 'MODULE_APP_RUNTIME_CONFIG_MISSING',
          status: 'unavailable',
        });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it('reports bounded readiness failures without exposing internal error details', async () => {
    const readinessCheck = vi
      .fn()
      .mockRejectedValue(new Error('/private/runtime/artifacts is unavailable'));
    const server = createModuleAppRuntimeServer({
      internalToken: 'internal-token',
      invoker: createInvoker(),
      readinessCheck,
      runtimeJwks: runtimePublicJwks,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
      expect(readiness.status).toBe(503);
      expect(JSON.parse(readiness.body)).toEqual({
        code: 'MODULE_APP_RUNTIME_UNAVAILABLE',
        status: 'unavailable',
      });
      expect(readiness.body).not.toContain('/private/runtime/artifacts');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('checks configuration, readable artifacts, and the rootless engine before readiness', async () => {
    const artifactRoot = path.join(tmpdir(), `module-runtime-${crypto.randomUUID()}`);
    temporaryRoots.push(artifactRoot);
    await mkdir(artifactRoot, { recursive: true });
    const healthCheck = vi.fn().mockResolvedValue(undefined);

    await expect(
      checkModuleAppRuntimeReadiness({
        artifactRoot,
        dockerArtifactRoot: '/var/lib/docker/volumes/artifacts/_data',
        engine: { healthCheck },
        internalToken: 'internal-token',
        node22Image: `sha256:${'a'.repeat(64)}`,
        python312Image: `sha256:${'b'.repeat(64)}`,
        runtimeJwks: runtimePublicJwks,
      }),
    ).resolves.toBeUndefined();
    expect(healthCheck).toHaveBeenCalledOnce();

    await expect(
      checkModuleAppRuntimeReadiness({
        artifactRoot,
        dockerArtifactRoot: '',
        engine: { healthCheck },
        internalToken: 'internal-token',
        node22Image: `sha256:${'a'.repeat(64)}`,
        python312Image: `sha256:${'b'.repeat(64)}`,
        runtimeJwks: runtimePublicJwks,
      }),
    ).rejects.toThrow('MODULE_APP_RUNTIME_CONFIG_MISSING');

    for (const dockerArtifactRoot of [
      'runtime/artifacts',
      'C:\\runtime\\artifacts',
      '/runtime/../artifacts',
      '/runtime/artifacts/',
      '/',
    ]) {
      await expect(
        checkModuleAppRuntimeReadiness({
          artifactRoot,
          dockerArtifactRoot,
          engine: { healthCheck },
          internalToken: 'internal-token',
          node22Image: `sha256:${'a'.repeat(64)}`,
          python312Image: `sha256:${'b'.repeat(64)}`,
          runtimeJwks: runtimePublicJwks,
        }),
      ).rejects.toThrow('MODULE_APP_RUNTIME_CONFIG_MISSING');
    }

    await expect(
      checkModuleAppRuntimeReadiness({
        artifactRoot,
        dockerArtifactRoot: '/var/lib/docker/volumes/artifacts/_data',
        engine: { healthCheck },
        internalToken: 'internal-token',
        node22Image: `sha256:${'a'.repeat(64)}`,
        python312Image: `sha256:${'b'.repeat(64)}`,
        runtimeJwks: '{"keys":[]}',
      }),
    ).rejects.toThrow('MODULE_APP_RUNTIME_CONFIG_MISSING');
    expect(healthCheck).toHaveBeenCalledOnce();
  });

  it('reports ready after the configured readiness check succeeds', async () => {
    const readinessCheck = vi.fn().mockResolvedValue(undefined);
    const server = createModuleAppRuntimeServer({
      internalToken: 'internal-token',
      invoker: createInvoker(),
      readinessCheck,
      runtimeJwks: runtimePublicJwks,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const readiness = await requestServer(`http://127.0.0.1:${address.port}/ready`);
      expect(readiness.status).toBe(200);
      expect(JSON.parse(readiness.body)).toEqual({ status: 'ready' });
      expect(readinessCheck).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('recognizes the current module through a filesystem entry path', () => {
    expect(isModuleAppRuntimeMain(import.meta.url, fileURLToPath(import.meta.url))).toBe(true);
  });

  it('binds invocation verification to the requested artifact hash', async () => {
    const artifactSha256 = 'a'.repeat(64);
    const verifyCapability = vi.fn().mockResolvedValue({ artifactSha256, surface: 'runtime' });
    const launcher = { invoke: vi.fn().mockResolvedValue({}) };
    const server = createModuleAppRuntimeServer({
      internalToken: 'internal-token',
      invoker: new ModuleAppRuntimeInvoker({ launcher }),
      runtimeJwks: runtimePublicJwks,
      verifyCapability,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const response = await requestServer(`http://127.0.0.1:${address.port}/v1/invocations`, {
        body: JSON.stringify({
          artifactSha256,
          capability: 'signed-runtime-capability',
          entry: 'server/search.js',
          input: { query: 'jobs' },
          invocationId: '00000000-0000-4000-8000-000000000001',
          runtime: 'node22',
          timeoutMs: 1000,
        }),
        headers: {
          'authorization': 'Bearer internal-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      expect(response.status).toBe(200);
      expect(verifyCapability).toHaveBeenCalledWith(
        'signed-runtime-capability',
        runtimePublicJwks,
        { artifactSha256 },
      );
      expect(launcher.invoke).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('serves immutable public assets only from a content-addressed artifact directory', async () => {
    const artifactRoot = path.join(tmpdir(), `module-runtime-${crypto.randomUUID()}`);
    temporaryRoots.push(artifactRoot);
    const artifactSha256 = 'a'.repeat(64);
    const assetDirectory = path.join(artifactRoot, artifactSha256, 'dist');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(path.join(assetDirectory, 'index.html'), '<!doctype html><title>Jobs</title>');
    const server = createModuleAppRuntimeServer({
      artifactRoot,
      internalToken: 'internal-token',
      invoker: createInvoker(),
      runtimeJwks: '{"keys":[]}',
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');

    try {
      const response = await requestServer(
        `http://127.0.0.1:${address.port}/artifacts/${artifactSha256}/dist/index.html`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain('<title>Jobs</title>');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
