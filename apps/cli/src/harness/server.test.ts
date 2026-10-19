import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FabHarnessServer } from './server';

describe('FabHarnessServer authorization boundary', () => {
  let dataRoot: string;
  let gateway: FabHarnessServer;
  const preflight = vi.fn<typeof fetch>();

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fab-harness-test-'));
    preflight.mockReset();
    gateway = new FabHarnessServer({
      dataRoot,
      fabServerUrl: 'https://fab.example',
      fetch: preflight,
      host: '127.0.0.1',
      port: 0,
    });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.close();
    await rm(dataRoot, { force: true, recursive: true });
  });

  const run = (body: Record<string, unknown>, token?: string) =>
    fetch(`http://127.0.0.1:${gateway.listeningPort}/v1/runs`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      method: 'POST',
    });

  const body = {
    agentType: 'codex',
    assistantMessageId: 'message-1',
    operationId: 'operation-1',
    prompt: 'safe test prompt',
    topicId: 'topic-1',
  };

  it('does not expose run endpoints without an operation token', async () => {
    const response = await run(body);
    expect(response.status).toBe(401);
    expect(preflight).not.toHaveBeenCalled();
  });

  it('rejects a provider mismatch before starting any official runtime', async () => {
    preflight.mockResolvedValueOnce(
      Response.json({
        expiresAt: 123,
        operationId: 'operation-1',
        provider: 'dsh',
        runtimeStatus: 'ready',
        tenantKey: 'a'.repeat(64),
      }),
    );

    const response = await run(body, 'operation-token');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'operation_scope_mismatch' });
  });

  it('asks Fab to authorize a resume id instead of trusting the client body', async () => {
    preflight.mockResolvedValueOnce(
      Response.json({
        expiresAt: 123,
        operationId: 'operation-1',
        provider: 'dsh',
        tenantKey: 'a'.repeat(64),
      }),
    );

    const response = await run(
      { ...body, resumeSessionId: 'native-thread-from-client' },
      'operation-token',
    );

    expect(response.status).toBe(403);
    const [, init] = preflight.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      resumeSessionId: 'native-thread-from-client',
      topicId: 'topic-1',
    });
  });

  it('rejects a non-opaque tenant partition instead of creating a path', async () => {
    preflight.mockResolvedValueOnce(
      Response.json({
        expiresAt: 123,
        operationId: 'operation-1',
        provider: 'codex',
        runtimeStatus: 'ready',
        tenantKey: '../../other-user',
      }),
    );

    const response = await run(body, 'operation-token');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_tenant_partition' });
  });

  it('lets the long-lived Codex client append app-server exactly once', async () => {
    const runtime = await (
      gateway as unknown as {
        codexRuntime: (tenantRoot: string) => Promise<{
          options: { args?: string[]; commandPath: string };
        }>;
      }
    ).codexRuntime(dataRoot);

    expect(runtime.options.commandPath).toBe('codex');
    expect(runtime.options.args).toEqual([]);
  });

  it('never removes persistent tenant state when the harness stops', async () => {
    const tenantState = path.join(dataRoot, 'tenant-a', 'codex-home', 'thread-state.json');
    await mkdir(path.dirname(tenantState), { recursive: true });
    await writeFile(tenantState, 'persistent');

    const second = new FabHarnessServer({
      dataRoot,
      fabServerUrl: 'https://fab.example',
      fetch: preflight,
      host: '127.0.0.1',
      port: 0,
    });
    await second.start();
    await second.close();

    await expect(readFile(tenantState, 'utf8')).resolves.toBe('persistent');
  });

  it('uses an existing official OpenClaw tenant cell without owning its lifecycle', async () => {
    const argsFile = path.join(dataRoot, 'openclaw-args.json');
    const stdinFile = path.join(dataRoot, 'openclaw-stdin.txt');
    const command = path.join(dataRoot, 'openclaw-mock');
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(stdinFile)}, stdin);
  process.stdout.write(JSON.stringify({ result: { payloads: [{ text: 'gateway reply' }] } }));
});
`,
    );
    await chmod(command, 0o700);

    const gatewayWithRuntime = new FabHarnessServer({
      dataRoot,
      fabServerUrl: 'https://fab.example',
      fetch: preflight,
      host: '127.0.0.1',
      openclawCommand: command,
      port: 0,
    }) as unknown as {
      runOfficialService: (
        body: Record<string, unknown>,
        tenantRoot: string,
        preflight: Record<string, unknown>,
        onProgress: (text: string) => void,
      ) => Promise<{ result: Promise<{ sessionId?: string; text: string }> }>;
    };
    const prompt = 'private prompt must stay out of argv';
    const run = await gatewayWithRuntime.runOfficialService(
      {
        agentType: 'openclaw',
        assistantMessageId: 'message-1',
        model: { id: 'gpt-5.6', providerId: 'openai' },
        operationId: 'operation-1',
        prompt,
        topicId: 'topic-1',
      },
      dataRoot,
      {
        expiresAt: 123,
        operationId: 'operation-1',
        provider: 'openclaw',
        runtimeRef: 'fab-openclaw-cell-tenant-a',
        runtimeStatus: 'ready',
        tenantKey: 'a'.repeat(64),
      },
      () => undefined,
    );

    await expect(run.result).resolves.toEqual({ sessionId: 'topic-1', text: 'gateway reply' });
    const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--container',
      'fab-openclaw-cell-tenant-a',
      'agent',
      '--session-id',
      'topic-1',
      '--message-file',
      '/dev/stdin',
      '--model',
      'openai/gpt-5.6',
      '--json',
    ]));
    expect(args).toContain('agent');
    expect(args.join(' ')).not.toContain(prompt);
    expect(await readFile(stdinFile, 'utf8')).toBe(prompt);
    expect(args).not.toContain('create');
    expect(args).not.toContain('start');
    expect(args).not.toContain('stop');
    expect(args).not.toContain('remove');
  });

  it('uses the official persistent Hermes runs API and its stop endpoint', async () => {
    const runtimeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ run_id: 'run-1', status: 'started' }, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({ output: 'hermes reply', session_id: 'topic-1', status: 'completed' }),
      );
    const resolveCredential = vi.fn(async () => 'runtime-secret');
    const gatewayWithRuntime = new FabHarnessServer({
      dataRoot,
      fabServerUrl: 'https://fab.example',
      fetch: runtimeFetch,
      hermesCredentialResolver: resolveCredential,
      host: '127.0.0.1',
      port: 0,
    }) as unknown as {
      runOfficialService: (
        body: Record<string, unknown>,
        tenantRoot: string,
        preflight: Record<string, unknown>,
        onProgress: (text: string) => void,
      ) => Promise<{ result: Promise<{ sessionId?: string; text: string }> }>;
    };
    await expect(
      gatewayWithRuntime.runOfficialService(
        {
          agentType: 'hermes',
          assistantMessageId: 'message-1',
          operationId: 'operation-1',
          prompt: 'continue safely',
          resumeSessionId: 'hermes-session-1',
          topicId: 'topic-1',
        },
        dataRoot,
        {
          expiresAt: 123,
          operationId: 'operation-1',
          provider: 'hermes',
          credentialRef: 'secret-store:hermes/tenant-a',
          runtimeRef: 'fab-hermes-profile-tenant-a',
          runtimeStatus: 'ready',
          tenantKey: 'a'.repeat(64),
        },
        () => undefined,
      ),
    ).rejects.toThrow('Invalid URL');

    const run = await gatewayWithRuntime.runOfficialService(
      {
        agentType: 'hermes',
        assistantMessageId: 'message-1',
        model: { id: 'claude-sonnet-4-6', providerId: 'anthropic' },
        operationId: 'operation-1',
        prompt: 'continue safely',
        topicId: 'topic-1',
      },
      dataRoot,
      {
        credentialRef: 'secret-store:hermes/tenant-a',
        expiresAt: 123,
        operationId: 'operation-1',
        provider: 'hermes',
        runtimeRef: 'http://127.0.0.1:8642/',
        runtimeStatus: 'ready',
        tenantKey: 'a'.repeat(64),
      },
      () => undefined,
    );
    await expect(run.result).resolves.toEqual({ sessionId: 'topic-1', text: 'hermes reply' });
    expect(resolveCredential).toHaveBeenCalledWith('secret-store:hermes/tenant-a');
    const [createUrl, createInit] = runtimeFetch.mock.calls[0];
    expect(String(createUrl)).toBe('http://127.0.0.1:8642/v1/runs');
    expect(JSON.parse(String(createInit?.body))).toMatchObject({
      input: 'continue safely',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      session_id: 'topic-1',
    });
    expect(createInit?.headers).toMatchObject({
      'idempotency-key': 'operation-1',
      'x-hermes-session-key': 'a'.repeat(64),
    });
  });
});
