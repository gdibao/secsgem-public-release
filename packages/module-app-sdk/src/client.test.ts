import { describe, expect, it, vi } from 'vitest';

import { MODULE_APP_BRIDGE_CHANNEL } from './bridge';
import { createModuleAppSdk, waitForModuleAppLaunch } from './client';

const RUNTIME_ORIGIN = 'https://module-runtime.example.com';
const NONCE = '0123456789abcdef0123456789abcdef';

const createHarness = () => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const eventTarget = {
    addEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.delete(listener);
    }),
  };
  const parentWindow = { postMessage: vi.fn() };
  const dispatch = (event: Partial<MessageEvent>) => {
    for (const listener of listeners) listener(event as MessageEvent);
  };
  const sdk = createModuleAppSdk({
    eventTarget: eventTarget as never,
    nonce: NONCE,
    parentWindow: parentWindow as never,
    randomId: () => 'request-1',
    runtimeOrigin: RUNTIME_ORIGIN,
  });

  return { dispatch, eventTarget, parentWindow, sdk };
};

describe('createModuleAppSdk', () => {
  it('performs an opaque-frame ready handshake before accepting launch credentials', async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const eventTarget = {
      addEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
        listeners.delete(listener);
      }),
    };
    const parentWindow = { postMessage: vi.fn() };
    const launch = waitForModuleAppLaunch({
      eventTarget: eventTarget as never,
      nonce: NONCE,
      parentWindow: parentWindow as never,
    });

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { channel: MODULE_APP_BRIDGE_CHANNEL, nonce: NONCE, type: 'ready' },
      '*',
    );
    for (const listener of listeners) {
      listener({
        data: {
          capability: 'attacker-capability',
          channel: MODULE_APP_BRIDGE_CHANNEL,
          hostOrigin: RUNTIME_ORIGIN,
          nonce: NONCE,
          type: 'launch',
        },
        origin: 'https://attacker.example.com',
        source: parentWindow,
      } as never);
    }
    for (const listener of listeners) {
      listener({
        data: {
          capability: 'signed-capability',
          channel: MODULE_APP_BRIDGE_CHANNEL,
          hostOrigin: RUNTIME_ORIGIN,
          nonce: NONCE,
          type: 'launch',
        },
        origin: RUNTIME_ORIGIN,
        source: parentWindow,
      } as never);
    }

    await expect(launch).resolves.toMatchObject({
      capability: 'signed-capability',
      hostOrigin: RUNTIME_ORIGIN,
    });
    expect(eventTarget.removeEventListener).toHaveBeenCalledOnce();
  });

  it('ignores responses from a wrong origin, source, or nonce', async () => {
    const { dispatch, parentWindow, sdk } = createHarness();
    const request = sdk.context();
    let settled = false;
    void request.finally(() => {
      settled = true;
    });

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'request-1',
        method: 'context.get',
        nonce: NONCE,
        type: 'request',
      }),
      RUNTIME_ORIGIN,
    );

    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: { userId: 'user-1' },
        type: 'response',
      },
      origin: 'https://attacker.example.com',
      source: parentWindow as never,
    });
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: 'wrong-nonce-0000',
        ok: true,
        result: {},
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: {},
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: {} as never,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: { userId: 'user-1' },
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    await expect(request).resolves.toEqual({ userId: 'user-1' });
  });

  it('subscribes only to trusted events and removes the bridge listener on dispose', () => {
    const { dispatch, eventTarget, parentWindow, sdk } = createHarness();
    const listener = vi.fn();
    const unsubscribe = sdk.on('progress', listener);

    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        event: 'progress',
        nonce: NONCE,
        payload: { percent: 10 },
        type: 'event',
      },
      origin: 'https://attacker.example.com',
      source: parentWindow as never,
    });
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        event: 'progress',
        nonce: NONCE,
        payload: { percent: 20 },
        type: 'event',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ percent: 20 });
    unsubscribe();
    sdk.dispose();
    expect(eventTarget.removeEventListener).toHaveBeenCalledOnce();
  });

  it('exposes typed managed data methods over the bridge', async () => {
    const { dispatch, parentWindow, sdk } = createHarness();
    const request = sdk.data.list({ limit: 20, tableKey: 'candidates' });

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'data.list', type: 'request' }),
      RUNTIME_ORIGIN,
    );
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: { items: [], nextCursor: null },
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    await expect(request).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('exposes the managed NewAPI chat contract over the bridge', async () => {
    const { dispatch, parentWindow, sdk } = createHarness();
    const request = sdk.ai.chat({
      messages: [{ content: 'Summarize this text.', role: 'user' }],
      model: 'gpt-4.1-mini',
    });

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ model: 'gpt-4.1-mini' }),
        method: 'ai.chat',
        type: 'request',
      }),
      RUNTIME_ORIGIN,
    );
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: {
          actualAiCredits: 1.5,
          model: 'gpt-4.1-mini',
          text: 'Summary',
          tokenUsage: { input: 12, output: 4, total: 16 },
        },
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    await expect(request).resolves.toMatchObject({ text: 'Summary' });
  });

  it('exposes the platform checkout contract without provider credentials', async () => {
    const { dispatch, parentWindow, sdk } = createHarness();
    const request = sdk.payments.createCheckout({
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      method: 'zpay_wechat',
      productId: '00000000-0000-4000-8000-000000000002',
    });

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'payments.checkout.create', type: 'request' }),
      RUNTIME_ORIGIN,
    );
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: {
          checkout: { type: 'qrcode', url: 'weixin://wxpay/bizpayurl?pr=example' },
          method: 'zpay_wechat',
          orderId: '00000000-0000-4000-8000-000000000003',
          outTradeNo: 'module-app-order-1',
          provider: 'zpay',
        },
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    await expect(request).resolves.toMatchObject({ provider: 'zpay' });
  });

  it('exposes task status over the bridge', async () => {
    const { dispatch, parentWindow, sdk } = createHarness();
    const request = sdk.tasks.getRun({ runId: '00000000-0000-4000-8000-000000000001' });
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'tasks.getRun', type: 'request' }),
      RUNTIME_ORIGIN,
    );
    dispatch({
      data: {
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        nonce: NONCE,
        ok: true,
        result: { id: 'run-1', status: 'running' },
        type: 'response',
      },
      origin: RUNTIME_ORIGIN,
      source: parentWindow as never,
    });
    await expect(request).resolves.toMatchObject({ status: 'running' });
  });
});
