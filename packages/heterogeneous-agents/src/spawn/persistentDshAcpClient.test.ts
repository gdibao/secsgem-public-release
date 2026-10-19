import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AcpStdioClientModule from './acpStdioClient';
import { PersistentDshAcpClient } from './persistentDshAcpClient';

const state = vi.hoisted(() => ({
  close: vi.fn(),
  drain: vi.fn(async () => undefined),
  notify: vi.fn(),
  options: undefined as any,
  request: vi.fn(),
  start: vi.fn(async () => undefined),
}));

vi.mock('./acpStdioClient', async (importOriginal) => {
  const actual = await importOriginal<typeof AcpStdioClientModule>();
  return {
    ...actual,
    AcpStdioClient: class {
      pid = 4242;

      constructor(options: unknown) {
        state.options = options;
      }

      close = state.close;
      drain = state.drain;
      notify = state.notify;
      request = state.request;
      start = state.start;
    },
  };
});

describe('PersistentDshAcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.options = undefined;
    state.request.mockImplementation(async (method: string, params: any) => {
      if (method === 'initialize') {
        return {
          agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
          protocolVersion: 1,
        };
      }
      if (method === 'session/new') return { sessionId: 'dsh-session-1' };
      if (method === 'session/resume') return { sessionId: params.sessionId };
      if (method === 'session/set_config_option') return { configOptions: [] };
      if (method === 'session/prompt') {
        await state.options.onMessage({
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            update: {
              content: { text: 'DSH reply', type: 'text' },
              sessionUpdate: 'agent_message_chunk',
            },
          },
        });
        return { stopReason: 'end_turn' };
      }
      if (method === 'session/close') return {};
      throw new Error(`Unexpected method: ${method}`);
    });
  });

  const createClient = () =>
    new PersistentDshAcpClient({
      clientVersion: '2.2.17-chituo',
      commandPath: 'dsh',
      cwd: '/workspace',
      env: process.env,
    });

  it('keeps one ACP process and resumes a native session across turns', async () => {
    const client = createClient();
    const firstEvents: unknown[] = [];
    const secondEvents: unknown[] = [];

    const sessionId = await client.runTurn({
      onEvents: (events) => {
        firstEvents.push(...events);
      },
      operationId: 'op-1',
      prompt: 'first',
    });
    await client.runTurn({
      onEvents: (events) => {
        secondEvents.push(...events);
      },
      operationId: 'op-2',
      prompt: 'second',
      resumeSessionId: sessionId,
    });

    expect(sessionId).toBe('dsh-session-1');
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.request.mock.calls.filter(([method]) => method === 'initialize')).toHaveLength(1);
    expect(state.request.mock.calls.filter(([method]) => method === 'session/new')).toHaveLength(1);
    expect(state.request.mock.calls.filter(([method]) => method === 'session/resume')).toHaveLength(
      0,
    );
    expect(state.request.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(
      2,
    );
    expect(firstEvents.length).toBeGreaterThan(0);
    expect(secondEvents.length).toBeGreaterThan(0);
    expect(state.close).not.toHaveBeenCalled();
  });

  it('uses ACP cancellation and closes only the requested native session', async () => {
    const client = createClient();
    let resolvePrompt!: (value: unknown) => void;
    state.request.mockImplementation(async (method: string) => {
      if (method === 'initialize') {
        return {
          agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
          protocolVersion: 1,
        };
      }
      if (method === 'session/new') return { sessionId: 'dsh-session-2' };
      if (method === 'session/prompt') {
        return new Promise((resolve) => {
          resolvePrompt = resolve;
        });
      }
      if (method === 'session/close') return {};
      throw new Error(`Unexpected method: ${method}`);
    });

    const running = client.runTurn({
      onEvents: () => undefined,
      operationId: 'op-cancel',
      prompt: 'wait',
    });
    await vi.waitFor(() => expect(resolvePrompt).toBeTypeOf('function'));
    client.interrupt('dsh-session-2');
    expect(state.notify).toHaveBeenCalledWith('session/cancel', {
      sessionId: 'dsh-session-2',
    });
    resolvePrompt({ stopReason: 'cancelled' });
    await running;

    await client.closeSession('dsh-session-2');
    expect(state.request).toHaveBeenCalledWith('session/close', {
      sessionId: 'dsh-session-2',
    });
    expect(state.close).not.toHaveBeenCalled();
  });

  it('selects the requested model through the official ACP config option', async () => {
    const client = createClient();

    await client.runTurn({
      model: 'deepseek-v4-pro',
      onEvents: () => undefined,
      operationId: 'op-model',
      prompt: 'use the selected model',
    });

    expect(state.request).toHaveBeenCalledWith('session/set_config_option', {
      configId: 'model',
      sessionId: 'dsh-session-1',
      value: 'deepseek-v4-pro',
    });
    const modelCall = state.request.mock.calls.findIndex(
      ([method]) => method === 'session/set_config_option',
    );
    const promptCall = state.request.mock.calls.findIndex(([method]) => method === 'session/prompt');
    expect(modelCall).toBeGreaterThanOrEqual(0);
    expect(promptCall).toBeGreaterThan(modelCall);
  });
});
