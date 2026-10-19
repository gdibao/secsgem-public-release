// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const importQstashModule = async () => import('./index');

describe('qstash clients', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.doUnmock('@upstash/qstash');
    vi.doUnmock('@upstash/workflow');
    vi.unstubAllEnvs();
  });

  it('does not create QStash clients at import time when QSTASH_TOKEN is empty', async () => {
    const qstashClient = vi.fn(function Client(this: any, config: any) {
      this.http = {};
      this.token = config?.token;
    });
    const workflowClient = vi.fn(function WorkflowClient(this: any, config: any) {
      this.trigger = vi.fn();
      this.token = config?.token;
    });

    vi.doMock('@upstash/qstash', () => ({
      Client: qstashClient,
      Receiver: vi.fn(),
    }));
    vi.doMock('@upstash/workflow', () => ({
      Client: workflowClient,
    }));
    vi.stubEnv('QSTASH_TOKEN', '');

    const qstash = await importQstashModule();

    expect(qstash.isQstashTokenAvailable()).toBe(false);
    expect(qstashClient).not.toHaveBeenCalled();
    expect(workflowClient).not.toHaveBeenCalled();
  });

  it('creates QStash clients lazily when a token is available', async () => {
    const qstashClient = vi.fn(function Client(this: any, config: any) {
      this.http = {};
      this.token = config?.token;
    });
    const workflowTrigger = vi.fn();
    const workflowClient = vi.fn(function WorkflowClient(this: any, config: any) {
      this.trigger = workflowTrigger;
      this.token = config?.token;
    });

    vi.doMock('@upstash/qstash', () => ({
      Client: qstashClient,
      Receiver: vi.fn(),
    }));
    vi.doMock('@upstash/workflow', () => ({
      Client: workflowClient,
    }));
    vi.stubEnv('QSTASH_TOKEN', 'test-qstash-token');

    const qstash = await importQstashModule();

    expect(qstash.isQstashTokenAvailable()).toBe(true);
    expect(qstashClient).not.toHaveBeenCalled();
    expect(workflowClient).not.toHaveBeenCalled();

    expect(Reflect.get(qstash.qstashClient, 'token')).toBe('test-qstash-token');
    expect(typeof qstash.workflowClient.trigger).toBe('function');

    expect(qstashClient).toHaveBeenCalledTimes(1);
    expect(workflowClient).toHaveBeenCalledTimes(1);
  });
});
