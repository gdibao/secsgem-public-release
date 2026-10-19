import { createHmac } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER,
  MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT,
  MODULE_APP_RUNTIME_READINESS_PROOF_HEADER,
  type ModuleAppRuntimeReadinessCode,
} from '@lobechat/types';
import { importJWK } from 'jose';

import { verifyRuntimeCapability } from './capability';
import {
  DockerCliModuleAppContainerEngine,
  isModuleAppContainerImageDigest,
} from './containerEngine';
import { FixedProcessModuleAppLauncher, ModuleAppRuntimeInvoker } from './invocation';
import { assertModuleAppRuntimePolicy } from './policy';

const MAX_REQUEST_BYTES = 1024 * 1024 + 16 * 1024;
const MODULE_APP_RUNTIME_ARTIFACT_ROOT = '/runtime/artifacts';
const MODULE_APP_RUNTIME_RECONCILE_INTERVAL_MS = 10_000;
const READINESS_CHALLENGE_PATTERN = /^[\w-]{32,128}$/;
const privateJwkParameters = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

const setReadinessProof = (
  request: IncomingMessage,
  response: ServerResponse,
  internalToken: string,
) => {
  const challenge = request.headers[MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER];
  if (
    typeof challenge !== 'string' ||
    !internalToken ||
    !READINESS_CHALLENGE_PATTERN.test(challenge)
  ) {
    return;
  }

  const proof = createHmac('sha256', internalToken)
    .update(MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT)
    .update('\0')
    .update(challenge)
    .digest('base64url');
  response.setHeader(MODULE_APP_RUNTIME_READINESS_PROOF_HEADER, proof);
};

const readinessFailureCodes = new Set<ModuleAppRuntimeReadinessCode>([
  'MODULE_APP_RUNTIME_ARTIFACT_ROOT_UNAVAILABLE',
  'MODULE_APP_RUNTIME_CONFIG_MISSING',
  'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
  'MODULE_APP_RUNTIME_DOCKER_ROOTLESS_REQUIRED',
  'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
]);

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const readJson = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error('MODULE_APP_RUNTIME_REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const sendNotFound = (response: ServerResponse) => sendJson(response, 404, { error: 'not_found' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasValidRuntimeJwks = async (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return false;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.keys)) return false;

  for (const key of parsed.keys) {
    if (
      !isRecord(key) ||
      key.alg !== 'RS256' ||
      key.kty !== 'RSA' ||
      privateJwkParameters.some((parameter) => parameter in key)
    ) {
      continue;
    }

    try {
      await importJWK(key, 'RS256');
      return true;
    } catch {
      continue;
    }
  }

  return false;
};

const isNormalizedAbsolutePosixPath = (value?: string): value is string =>
  Boolean(
    value &&
    value === value.trim() &&
    value !== '/' &&
    path.posix.isAbsolute(value) &&
    path.posix.resolve(value) === value,
  );

const getReadinessFailureCode = (error: unknown): ModuleAppRuntimeReadinessCode => {
  if (
    error instanceof Error &&
    readinessFailureCodes.has(error.message as ModuleAppRuntimeReadinessCode)
  ) {
    return error.message as ModuleAppRuntimeReadinessCode;
  }

  return 'MODULE_APP_RUNTIME_UNAVAILABLE';
};

export const checkModuleAppRuntimeReadiness = async (options: {
  artifactRoot: string;
  dockerArtifactRoot?: string;
  engine: Pick<DockerCliModuleAppContainerEngine, 'healthCheck'>;
  internalToken: string;
  node22Image?: string;
  python312Image?: string;
  runtimeJwks: string;
}) => {
  if (
    !options.internalToken.trim() ||
    !isNormalizedAbsolutePosixPath(options.dockerArtifactRoot) ||
    !isModuleAppContainerImageDigest(options.node22Image) ||
    !isModuleAppContainerImageDigest(options.python312Image)
  ) {
    throw new Error('MODULE_APP_RUNTIME_CONFIG_MISSING');
  }
  if (!(await hasValidRuntimeJwks(options.runtimeJwks))) {
    throw new Error('MODULE_APP_RUNTIME_CONFIG_MISSING');
  }

  try {
    const artifactRoot = await stat(options.artifactRoot);
    if (!artifactRoot.isDirectory()) {
      throw new Error('MODULE_APP_RUNTIME_ARTIFACT_ROOT_UNAVAILABLE');
    }
    await access(options.artifactRoot, constants.R_OK);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'MODULE_APP_RUNTIME_ARTIFACT_ROOT_UNAVAILABLE'
    ) {
      throw error;
    }
    throw new Error('MODULE_APP_RUNTIME_ARTIFACT_ROOT_UNAVAILABLE', { cause: error });
  }

  await options.engine.healthCheck();
};

const serveRuntimeAsset = async (
  request: IncomingMessage,
  response: ServerResponse,
  artifactRoot: string,
) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = new URL(request.url ?? '/', 'http://module-runtime.internal').pathname;
  const match = pathname.match(/^\/artifacts\/([a-f0-9]{64})\/(.+)$/i);
  if (!match) return false;

  try {
    const artifactDirectory = await realpath(path.join(artifactRoot, match[1]));
    const assetPath = await realpath(path.join(artifactDirectory, decodeURIComponent(match[2])));
    const relativePath = path.relative(artifactDirectory, assetPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      sendNotFound(response);
      return true;
    }
    const asset = await stat(assetPath);
    if (!asset.isFile()) {
      sendNotFound(response);
      return true;
    }
    const host = request.headers.host?.toLowerCase();
    const trustedHost = host && /^[a-z0-9.-]+(?::\d+)?$/.test(host) ? host : undefined;
    const assetOrigins = trustedHost ? `http://${trustedHost} https://${trustedHost}` : '';

    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': asset.size,
      'content-security-policy':
        `default-src 'none'; base-uri 'none'; connect-src 'none'; font-src ${assetOrigins} data:; ` +
        `frame-ancestors *; img-src ${assetOrigins} data: blob:; object-src 'none'; ` +
        `script-src ${assetOrigins} 'unsafe-inline'; style-src ${assetOrigins} 'unsafe-inline'`,
      'content-type':
        contentTypes[path.extname(assetPath).toLowerCase()] ?? 'application/octet-stream',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }
    const stream = createReadStream(assetPath);
    stream.once('error', () => response.destroy());
    stream.pipe(response);
    return true;
  } catch {
    sendNotFound(response);
    return true;
  }
};

export const createModuleAppRuntimeServer = (options: {
  artifactRoot?: string;
  internalToken: string;
  invocationEnabled?: boolean;
  invoker?: ModuleAppRuntimeInvoker;
  readinessCheck?: () => Promise<void>;
  runtimeJwks: string;
  verifyCapability?: typeof verifyRuntimeCapability;
}) => {
  const invocationEnabled = options.invocationEnabled ?? true;
  const invocationConfigured = Boolean(options.internalToken.trim() && options.invoker);
  const runtimeJwksValidation = hasValidRuntimeJwks(options.runtimeJwks);
  const isInvocationConfigured = async () => invocationConfigured && (await runtimeJwksValidation);

  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      setReadinessProof(request, response, options.internalToken);
      if (!invocationEnabled) {
        sendJson(response, 200, { status: 'disabled' });
        return;
      }
      if (!(await isInvocationConfigured())) {
        sendJson(response, 503, {
          code: 'MODULE_APP_RUNTIME_CONFIG_MISSING',
          status: 'unavailable',
        });
        return;
      }

      try {
        await options.readinessCheck?.();
        sendJson(response, 200, { status: 'ready' });
      } catch (error) {
        sendJson(response, 503, {
          code: getReadinessFailureCode(error),
          status: 'unavailable',
        });
      }
      return;
    }
    if (
      await serveRuntimeAsset(
        request,
        response,
        options.artifactRoot ?? MODULE_APP_RUNTIME_ARTIFACT_ROOT,
      )
    ) {
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/invocations') {
      sendNotFound(response);
      return;
    }
    if (!invocationEnabled) {
      sendJson(response, 503, { error: 'MODULE_APP_RUNTIME_INVOCATION_DISABLED' });
      return;
    }
    if (!(await isInvocationConfigured())) {
      sendJson(response, 503, { error: 'MODULE_APP_RUNTIME_CONFIG_MISSING' });
      return;
    }
    if (request.headers.authorization !== `Bearer ${options.internalToken}`) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    try {
      const input = assertModuleAppRuntimePolicy(await readJson(request));
      await (options.verifyCapability ?? verifyRuntimeCapability)(
        input.capability,
        options.runtimeJwks,
        { artifactSha256: input.artifactSha256 },
      );
      sendJson(response, 200, await options.invoker!.invoke(input));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MODULE_APP_RUNTIME_FAILED';
      sendJson(response, 400, { error: code });
    }
  });
};

export const startModuleAppRuntimeServerFromEnv = (
  options: {
    engine?: DockerCliModuleAppContainerEngine;
    reconcileIntervalMs?: number;
  } = {},
) => {
  const invocationEnabled =
    process.env.MODULE_APP_EXECUTION_ENABLED === 'true' &&
    process.env.MODULE_APP_RUNTIME_INVOCATION_ENABLED === 'true';

  const engine = options.engine ?? new DockerCliModuleAppContainerEngine();
  const artifactRoot = MODULE_APP_RUNTIME_ARTIFACT_ROOT;
  const dockerArtifactRoot = process.env.MODULE_APP_RUNTIME_DOCKER_ARTIFACT_ROOT;
  const internalToken = process.env.MODULE_APP_RUNTIME_INTERNAL_TOKEN ?? '';
  const node22Image = process.env.MODULE_APP_RUNTIME_NODE22_IMAGE;
  const python312Image = process.env.MODULE_APP_RUNTIME_PYTHON312_IMAGE;
  const runtimeJwks = process.env.MODULE_APP_RUNTIME_JWKS ?? '';
  const runtimeImages =
    node22Image &&
    python312Image &&
    isModuleAppContainerImageDigest(node22Image) &&
    isModuleAppContainerImageDigest(python312Image)
      ? { node22: node22Image, python312: python312Image }
      : undefined;
  const server = createModuleAppRuntimeServer({
    artifactRoot,
    internalToken,
    invocationEnabled,
    invoker:
      invocationEnabled && isNormalizedAbsolutePosixPath(dockerArtifactRoot) && runtimeImages
        ? new ModuleAppRuntimeInvoker({
            launcher: new FixedProcessModuleAppLauncher({
              artifactRoot,
              dockerArtifactRoot,
              engine,
              images: runtimeImages,
            }),
          })
        : undefined,
    readinessCheck: () =>
      checkModuleAppRuntimeReadiness({
        artifactRoot,
        dockerArtifactRoot,
        engine,
        internalToken,
        node22Image,
        python312Image,
        runtimeJwks,
      }),
    runtimeJwks,
  });
  const reconcile = () => void engine.reconcileStaleContainers().catch(() => undefined);
  reconcile();
  const reconcileTimer = setInterval(
    reconcile,
    options.reconcileIntervalMs ?? MODULE_APP_RUNTIME_RECONCILE_INTERVAL_MS,
  );
  reconcileTimer.unref();
  server.once('close', () => clearInterval(reconcileTimer));
  server.listen(Number(process.env.PORT ?? 3210), '0.0.0.0');
  return server;
};

export const isModuleAppRuntimeMain = (moduleUrl: string, entryPath?: string) =>
  Boolean(entryPath && moduleUrl === pathToFileURL(entryPath).href);

if (isModuleAppRuntimeMain(import.meta.url, process.argv[1])) {
  startModuleAppRuntimeServerFromEnv();
}
