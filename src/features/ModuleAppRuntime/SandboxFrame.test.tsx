import { MODULE_APP_BRIDGE_CHANNEL } from '@lobechat/module-app-sdk';
import type { ModuleAppLaunchContext } from '@lobechat/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SandboxFrame from './SandboxFrame';

const launchContext: ModuleAppLaunchContext = {
  capability: 'signed-browser-capability',
  displayName: 'Jobs Board',
  expiresAt: '2026-07-11T08:05:00.000Z',
  iframeUrl: 'https://module-runtime.example.com/artifacts/hash/dist/index.html?nonce=launch-nonce-0001',
  installationId: '00000000-0000-4000-8000-000000000001',
  nonce: 'launch-nonce-0001',
  runtimeOrigin: 'https://module-runtime.example.com',
};

describe('SandboxFrame', () => {
  it('renders a fixed sandbox without same-origin privileges', () => {
    render(<SandboxFrame context={launchContext} title="Jobs Board" />);

    const frame = screen.getByTitle('Jobs Board');
    expect(frame).toHaveAttribute('sandbox', 'allow-forms allow-scripts allow-downloads');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('sends the capability only after a ready message from the opaque frame and matching nonce', () => {
    render(<SandboxFrame context={launchContext} title="Jobs Board" />);

    const frame = screen.getByTitle('Jobs Board') as HTMLIFrameElement;
    const frameWindow = frame.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: MODULE_APP_BRIDGE_CHANNEL,
            nonce: 'wrong-launch-nonce',
            type: 'ready',
          },
          origin: 'null',
          source: frameWindow,
        }),
      );
    });
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: MODULE_APP_BRIDGE_CHANNEL,
            nonce: launchContext.nonce,
            type: 'ready',
          },
          origin: 'null',
          source: frameWindow,
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: launchContext.capability,
        channel: MODULE_APP_BRIDGE_CHANNEL,
        nonce: launchContext.nonce,
        type: 'launch',
      }),
      '*',
    );
  });

  it('relays SDK requests only after launch and returns a nonce-bound response', async () => {
    const invoke = vi.fn().mockResolvedValue({ userId: 'user-1' });
    render(<SandboxFrame context={launchContext} invoke={invoke} title="Jobs Board" />);
    const frame = screen.getByTitle('Jobs Board') as HTMLIFrameElement;
    const frameWindow = frame.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    const dispatch = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: 'null',
          source: frameWindow,
        }),
      );
    act(() => {
      dispatch({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-before-ready',
        input: {},
        method: 'context.get',
        nonce: launchContext.nonce,
        type: 'request',
      });
    });
    expect(invoke).not.toHaveBeenCalled();

    act(() => {
      dispatch({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        nonce: launchContext.nonce,
        type: 'ready',
      });
    });
    postMessage.mockClear();
    act(() => {
      dispatch({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        input: {},
        method: 'context.get',
        nonce: launchContext.nonce,
        type: 'request',
      });
    });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith({
        capability: launchContext.capability,
        input: {},
        method: 'context.get',
        requestId: 'request-1',
      }),
    );
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'request-1',
          nonce: launchContext.nonce,
          ok: true,
          type: 'response',
        }),
        '*',
      ),
    );
  });

  it('redacts arbitrary relay failure messages from the sandbox', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('upstream https://internal.example/secret'));
    render(<SandboxFrame context={launchContext} invoke={invoke} title="Jobs Board" />);
    const frame = screen.getByTitle('Jobs Board') as HTMLIFrameElement;
    const frameWindow = frame.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    const dispatch = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', { data, origin: 'null', source: frameWindow }),
      );

    act(() => {
      dispatch({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        nonce: launchContext.nonce,
        type: 'ready',
      });
    });
    postMessage.mockClear();
    act(() => {
      dispatch({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        input: {},
        method: 'context.get',
        nonce: launchContext.nonce,
        type: 'request',
      });
    });

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { code: 'MODULE_APP_SDK_REQUEST_FAILED' },
          id: 'request-1',
          ok: false,
        }),
        '*',
      ),
    );
  });
});
