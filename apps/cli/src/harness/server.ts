import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import {
  buildCodexAppServerThreadParams,
  CodexAppServerClient,
  CodexThreadSession,
  PersistentDshAcpClient,
} from '@lobechat/heterogeneous-agents/spawn';

import { createLambdaClient } from '../api/client';
import { cliVersion } from '../pkg';
import { CoalescingBatchIngester } from '../utils/CoalescingBatchIngester';
import { TrpcIngestSink } from '../utils/TrpcIngestSink';

const MAX_BODY_BYTES = 1024 * 1024;
const TENANT_KEY = /^[a-f0-9]{64}$/;

type HarnessType = 'codex' | 'dsh' | 'hermes' | 'openclaw';

interface HarnessPreflight {
  credentialRef?: string | null;
  expiresAt: number;
  operationId: string;
  provider: HarnessType;
  runtimeRef?: string | null;
  runtimeStatus: string;
  tenantKey: string;
}

interface HarnessRunRequest {
  agentType: HarnessType;
  assistantMessageId: string;
  model?: { id: string; providerId: string };
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  systemContext?: string;
  topicId: string;
}

interface ActiveRun {
  cancel: () => Promise<void> | void;
  operationId: string;
}

export interface HarnessServerOptions {
  codexCommand?: string;
  codexConfigTemplate?: string;
  dataRoot: string;
  dshCommand?: string;
  fabServerUrl: string;
  fetch?: typeof fetch;
  hermesCommand?: string;
  hermesCredentialResolver?: (credentialRef: string) => Promise<string>;
  host: string;
  openclawCommand?: string;
  port: number;
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const readJson = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
};

const bearerToken = (request: IncomingMessage): string | undefined => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
};

const assertRunRequest = (input: HarnessRunRequest): void => {
  if (!input || !['codex', 'dsh', 'hermes', 'openclaw'].includes(input.agentType)) {
    throw new Error('unsupported_harness');
  }
  for (const value of [input.assistantMessageId, input.operationId, input.prompt, input.topicId]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_request');
  }
  if (
    input.model &&
    (typeof input.model.id !== 'string' ||
      !input.model.id.trim() ||
      typeof input.model.providerId !== 'string' ||
      !input.model.providerId.trim())
  ) {
    throw new Error('invalid_model_selection');
  }
};

/** Trusted worker for official long-running Codex app-server and DSH ACP runtimes. */
export class FabHarnessServer {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly codexClients = new Map<string, CodexAppServerClient>();
  private readonly dshClients = new Map<string, PersistentDshAcpClient>();
  private readonly fetchImpl: typeof fetch;
  private server?: ReturnType<typeof createServer>;

  constructor(private readonly options: HarnessServerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  get listeningPort(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }

  async start(): Promise<void> {
    await mkdir(this.options.dataRoot, { recursive: true, mode: 0o700 });
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port, this.options.host, resolve);
    });
  }

  async close(): Promise<void> {
    for (const run of this.activeRuns.values()) await run.cancel();
    this.activeRuns.clear();
    for (const client of this.codexClients.values()) client.close();
    for (const client of this.dshClients.values()) client.close();
    this.codexClients.clear();
    this.dshClients.clear();
    if (this.server) {
      await new Promise<void>((resolve, reject) =>
        this.server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/healthz') {
      return json(response, 200, { activeRuns: this.activeRuns.size, ok: true });
    }

    const token = bearerToken(request);
    if (!token) return json(response, 401, { error: 'unauthorized' });

    try {
      if (request.method === 'POST' && request.url === '/v1/runs') {
        const body = await readJson<HarnessRunRequest>(request);
        assertRunRequest(body);
        const preflight = await this.preflight(token, body.topicId, body.resumeSessionId);
        if (preflight.operationId !== body.operationId || preflight.provider !== body.agentType) {
          return json(response, 403, { error: 'operation_scope_mismatch' });
        }
        if (this.activeRuns.has(body.operationId)) {
          return json(response, 409, { error: 'operation_already_running' });
        }

        const tenantRoot = await this.resolveTenantRoot(preflight.tenantKey);
        json(response, 202, { accepted: true, operationId: body.operationId });
        void this.run(body, token, tenantRoot, preflight).catch(() => {
          // The terminal callback carries the sanitized failure to Fab. Never
          // log prompts, operation tokens, tenant keys, or runtime stderr here.
        });
        return;
      }

      const cancelMatch = request.url?.match(/^\/v1\/runs\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        const operationId = decodeURIComponent(cancelMatch[1]);
        const preflight = await this.preflight(token, undefined);
        if (preflight.operationId !== operationId) {
          return json(response, 403, { error: 'operation_scope_mismatch' });
        }
        const run = this.activeRuns.get(operationId);
        if (!run) return json(response, 404, { error: 'run_not_found' });
        await run.cancel();
        return json(response, 202, { accepted: true, operationId });
      }

      json(response, 404, { error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request_failed';
      const status = message === 'request_too_large' ? 413 : 400;
      json(response, status, { error: message });
    }
  }

  private async preflight(
    token: string,
    topicId?: string,
    resumeSessionId?: string,
  ): Promise<HarnessPreflight> {
    const response = await this.fetchImpl(
      new URL('/api/agent/harness/preflight', this.options.fabServerUrl),
      {
        body: JSON.stringify({
          ...(resumeSessionId ? { resumeSessionId } : {}),
          ...(topicId ? { topicId } : {}),
        }),
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    );
    if (!response.ok) throw new Error(`preflight_rejected_${response.status}`);
    return (await response.json()) as HarnessPreflight;
  }

  private async resolveTenantRoot(tenantKey: string): Promise<string> {
    if (!TENANT_KEY.test(tenantKey)) throw new Error('invalid_tenant_partition');
    const root = path.resolve(this.options.dataRoot, tenantKey);
    if (!root.startsWith(`${path.resolve(this.options.dataRoot)}${path.sep}`)) {
      throw new Error('invalid_tenant_partition');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  private async run(
    body: HarnessRunRequest,
    token: string,
    tenantRoot: string,
    preflight: HarnessPreflight,
  ): Promise<void> {
    const client = createLambdaClient({
      serverUrl: this.options.fabServerUrl,
      token,
      tokenType: 'jwt',
    });
    const sink = new TrpcIngestSink(
      client,
      body.agentType,
      body.operationId,
      body.topicId,
      body.assistantMessageId,
    );
    const ingester = new CoalescingBatchIngester(sink);
    let sessionId: string | undefined;
    let cancelled = false;

    try {
      if (body.agentType === 'codex') {
        const runtime = await this.codexRuntime(tenantRoot);
        const session = new CodexThreadSession({
          client: runtime,
          initialThreadId: body.resumeSessionId,
          onEvents: (events) => this.pushEvents(ingester, events),
          onRuntimeStatus: () => undefined,
          onSessionId: (value) => {
            sessionId = value;
          },
          sessionId: body.operationId,
          threadParams: buildCodexAppServerThreadParams(
            ['--full-auto'],
            tenantRoot,
            body.model?.id,
          ),
        });
        this.activeRuns.set(body.operationId, {
          cancel: () => {
            cancelled = true;
            return session.interrupt();
          },
          operationId: body.operationId,
        });
        await session.run({
          input: [
            {
              text: [body.systemContext, body.prompt].filter(Boolean).join('\n\n'),
              text_elements: [],
              type: 'text',
            },
          ],
          onRawMessage: () => undefined,
          operationId: body.operationId,
        });
        session.close();
      } else {
        if (body.agentType === 'hermes' || body.agentType === 'openclaw') {
          const process = await this.runOfficialService(body, tenantRoot, preflight, (text) => {
            this.pushText(ingester, body.operationId, text);
          });
          this.activeRuns.set(body.operationId, {
            cancel: () => {
              cancelled = true;
              return process.cancel();
            },
            operationId: body.operationId,
          });
          const result = await process.result;
          sessionId = result.sessionId;
          if (result.text) this.pushText(ingester, body.operationId, result.text);
        } else {
          const runtime = this.dshRuntime(tenantRoot);
          this.activeRuns.set(body.operationId, {
            cancel: () => {
              cancelled = true;
              if (sessionId) runtime.interrupt(sessionId);
            },
            operationId: body.operationId,
          });
          sessionId = await runtime.runTurn({
            model: body.model?.id,
            onEvents: (events) => this.pushEvents(ingester, events),
            operationId: body.operationId,
            prompt: [body.systemContext, body.prompt].filter(Boolean).join('\n\n'),
            resumeSessionId: body.resumeSessionId,
          });
        }
      }

      await ingester.drain();
      await sink.finish({ result: cancelled ? 'cancelled' : 'success', sessionId });
    } catch (error) {
      await ingester.drain().catch(() => undefined);
      await sink.finish({
        error: {
          message: error instanceof Error ? error.message.slice(0, 1024) : 'Harness run failed',
          type: 'AgentRuntimeError',
        },
        result: cancelled ? 'cancelled' : 'error',
        sessionId,
      });
    } finally {
      this.activeRuns.delete(body.operationId);
    }
  }

  private pushEvents(ingester: CoalescingBatchIngester, events: AgentStreamEvent[]): void {
    for (const event of events) ingester.push(event);
  }

  private pushText(ingester: CoalescingBatchIngester, operationId: string, content: string): void {
    if (!content.trim()) return;
    ingester.push({
      data: { chunkType: 'text', content },
      operationId,
      stepIndex: 0,
      timestamp: Date.now(),
      type: 'stream_chunk',
    } as AgentStreamEvent);
  }

  /**
   * Connect only to an already-provisioned official persistent service.
   * This request path never creates, starts, stops, or removes tenant cells.
   */
  private async runOfficialService(
    body: HarnessRunRequest,
    tenantRoot: string,
    preflight: HarnessPreflight,
    onProgress: (text: string) => void,
  ): Promise<{
    cancel: () => Promise<void> | void;
    result: Promise<{ sessionId?: string; text: string }>;
  }> {
    if (body.agentType === 'hermes') {
      return this.runHermesApi(body, preflight);
    }
    if (body.agentType !== 'openclaw') throw new Error('unsupported_official_service');
    if (preflight.runtimeStatus !== 'ready' || !preflight.runtimeRef) {
      throw new Error('openclaw_persistent_cell_not_ready');
    }

    const command = this.options.openclawCommand ?? 'openclaw';
    const sessionId = body.resumeSessionId || body.topicId;
    const message = [body.systemContext, body.prompt].filter(Boolean).join('\n\n');
    const args = [
      '--container',
      preflight.runtimeRef,
      'agent',
      '--session-id',
      sessionId,
      '--message-file',
      '/dev/stdin',
      ...(body.model ? ['--model', `${body.model.providerId}/${body.model.id}`] : []),
      '--json',
    ];
    const child: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd: tenantRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(message);

    const result = new Promise<{ sessionId?: string; text: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const append = (current: string, chunk: Buffer) => {
        const next = current + chunk.toString('utf8');
        if (next.length > 8 * 1024 * 1024) throw new Error('harness_output_too_large');
        return next;
      };
      child.stdout.on('data', (chunk: Buffer) => {
        try {
          stdout = append(stdout, chunk);
        } catch (error) {
          child.kill('SIGKILL');
          reject(error);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        try {
          stderr = append(stderr, chunk);
        } catch (error) {
          child.kill('SIGKILL');
          reject(error);
        }
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code !== 0) {
          reject(new Error(`${body.agentType}_runtime_failed_${signal || code}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>;
          const officialResult =
            parsed.result && typeof parsed.result === 'object'
              ? (parsed.result as Record<string, unknown>)
              : undefined;
          const payloadText = Array.isArray(officialResult?.payloads)
            ? officialResult.payloads
                .map((payload) =>
                  payload && typeof payload === 'object'
                    ? (payload as Record<string, unknown>).text
                    : undefined,
                )
                .filter((text): text is string => typeof text === 'string' && text.length > 0)
                .join('\n')
            : '';
          const text =
            payloadText ||
            (typeof parsed.response === 'string' && parsed.response) ||
            (typeof parsed.text === 'string' && parsed.text) ||
            (typeof parsed.message === 'string' && parsed.message) ||
            stdout.trim();
          resolve({ sessionId, text });
        } catch {
          resolve({ sessionId, text: stdout.trim() });
        }
      });
    });

    onProgress('');
    return {
      cancel: () => {
        child.kill('SIGINT');
      },
      result,
    };
  }

  /** Official Hermes API Server runs API; no Hermes internals or protocol shims. */
  private async runHermesApi(
    body: HarnessRunRequest,
    preflight: HarnessPreflight,
  ): Promise<{
    cancel: () => Promise<void>;
    result: Promise<{ sessionId?: string; text: string }>;
  }> {
    if (
      preflight.runtimeStatus !== 'ready' ||
      !preflight.runtimeRef ||
      !preflight.credentialRef ||
      !this.options.hermesCredentialResolver
    ) {
      throw new Error('hermes_persistent_profile_not_ready');
    }

    const baseUrl = new URL(
      preflight.runtimeRef.endsWith('/') ? preflight.runtimeRef : `${preflight.runtimeRef}/`,
    );
    if (!['http:', 'https:'].includes(baseUrl.protocol)) {
      throw new Error('hermes_runtime_ref_invalid');
    }
    const apiKey = await this.options.hermesCredentialResolver(preflight.credentialRef);
    if (!apiKey) throw new Error('hermes_credential_unavailable');
    const headers = {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-hermes-session-key': preflight.tenantKey,
    };
    const createResponse = await this.fetchImpl(new URL('v1/runs', baseUrl), {
      body: JSON.stringify({
        input: body.prompt,
        instructions: body.systemContext,
        ...(body.model ? { model: body.model.id, provider: body.model.providerId } : {}),
        session_id: body.resumeSessionId || body.topicId,
      }),
      headers: { ...headers, 'idempotency-key': body.operationId },
      method: 'POST',
    });
    if (!createResponse.ok) throw new Error(`hermes_run_rejected_${createResponse.status}`);
    const created = (await createResponse.json()) as { run_id?: unknown };
    if (typeof created.run_id !== 'string' || !created.run_id) {
      throw new Error('hermes_run_id_missing');
    }
    const runId = created.run_id;

    let cancelled = false;
    const stop = async () => {
      cancelled = true;
      const response = await this.fetchImpl(
        new URL(`v1/runs/${encodeURIComponent(runId)}/stop`, baseUrl),
        { headers, method: 'POST' },
      );
      if (!response.ok && response.status !== 409) {
        throw new Error(`hermes_stop_rejected_${response.status}`);
      }
    };
    const result = (async () => {
      const deadline = Date.now() + 60 * 60 * 1000;
      while (Date.now() < deadline) {
        const response = await this.fetchImpl(
          new URL(`v1/runs/${encodeURIComponent(runId)}`, baseUrl),
          { headers },
        );
        if (!response.ok) throw new Error(`hermes_status_rejected_${response.status}`);
        const status = (await response.json()) as {
          error?: unknown;
          output?: unknown;
          session_id?: unknown;
          status?: unknown;
        };
        if (status.status === 'completed') {
          return {
            sessionId:
              typeof status.session_id === 'string' ? status.session_id : body.resumeSessionId,
            text: typeof status.output === 'string' ? status.output : '',
          };
        }
        if (['cancelled', 'failed', 'interrupted'].includes(String(status.status))) {
          throw new Error(cancelled ? 'hermes_run_cancelled' : `hermes_run_${status.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('hermes_run_timeout');
    })();
    return { cancel: stop, result };
  }

  private async codexRuntime(tenantRoot: string): Promise<CodexAppServerClient> {
    const existing = this.codexClients.get(tenantRoot);
    if (existing) return existing;
    const codexHome = path.join(tenantRoot, 'codex-home');
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    if (this.options.codexConfigTemplate) {
      const target = path.join(codexHome, 'config.toml');
      try {
        await copyFile(this.options.codexConfigTemplate, target);
        await chmod(target, 0o600);
      } catch (error) {
        throw new Error('codex_config_seed_failed', { cause: error });
      }
    }
    const client = new CodexAppServerClient({
      // CodexAppServerClient appends the app-server subcommand itself.
      args: [],
      clientVersion: cliVersion,
      commandPath: this.options.codexCommand ?? 'codex',
      cwd: tenantRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    this.codexClients.set(tenantRoot, client);
    return client;
  }

  private dshRuntime(tenantRoot: string): PersistentDshAcpClient {
    const existing = this.dshClients.get(tenantRoot);
    if (existing) return existing;
    const dshHome = path.join(tenantRoot, 'dsh-home');
    mkdirSync(dshHome, { recursive: true, mode: 0o700 });
    const client = new PersistentDshAcpClient({
      clientVersion: cliVersion,
      commandPath: this.options.dshCommand ?? 'dsh',
      cwd: tenantRoot,
      env: { ...process.env, DSH_HOME: dshHome, HOME: dshHome },
    });
    this.dshClients.set(tenantRoot, client);
    return client;
  }
}
