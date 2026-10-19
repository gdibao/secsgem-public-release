import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocmeeIframeAdapter, type DocmeeIframeOptions } from './docmeeIframe';

const adapters: DocmeeIframeAdapter[] = [];

const createAdapter = (overrides: Partial<DocmeeIframeOptions> = {}) => {
  const container = document.createElement('div');
  document.body.append(container);

  const adapter = new DocmeeIframeAdapter({
    baseUrl: 'https://docmee.cn',
    container,
    creatorVersion: 'v2',
    downloadButton: ['pptx', 'pdf'],
    isMobile: false,
    lang: 'zh',
    mode: 'light',
    page: 'creator-v2',
    token: 'token-1',
    ...overrides,
  });
  adapters.push(adapter);

  const iframe = container.querySelector('iframe');
  if (!iframe?.contentWindow) throw new Error('Docmee iframe was not mounted');

  return { adapter, container, iframe };
};

const dispatchMessage = (
  iframe: HTMLIFrameElement,
  origin: string,
  data: Record<string, unknown>,
) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
      source: iframe.contentWindow,
    }),
  );
};

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('DocmeeIframeAdapter', () => {
  it('mounts the requested page and transfers runtime parameters without putting the token in the URL', () => {
    const { iframe } = createAdapter();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    expect(iframe.src).toBe('https://docmee.cn/sdk-ui/creator-v2');
    expect(iframe.src).not.toContain('token-1');
    expect(iframe.getAttribute('allow')).toContain('fullscreen');

    iframe.dispatchEvent(new Event('load'));

    expect(postMessage).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          creatorVersion: 'v2',
          downloadButton: ['pptx', 'pdf'],
          iframe: '1',
          isMobile: false,
          lang: 'zh',
          mode: 'light',
          token: 'token-1',
        }),
        type: 'transParams',
      },
      'https://docmee.cn',
    );
  });

  it('accepts events only from the mounted iframe and configured origin', async () => {
    const onMessage = vi.fn();
    const mounted = vi.fn();
    const { adapter, iframe } = createAdapter({ onMessage });
    adapter.on('mounted', mounted);

    dispatchMessage(iframe, 'https://attacker.example', { type: 'mounted' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'mounted' },
        origin: 'https://docmee.cn',
        source: window,
      }),
    );

    expect(onMessage).not.toHaveBeenCalled();
    expect(mounted).not.toHaveBeenCalled();

    dispatchMessage(iframe, 'https://docmee.cn', { type: 'mounted' });

    await vi.waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({ type: 'mounted' });
      expect(mounted).toHaveBeenCalledWith({ type: 'mounted' });
    });
  });

  it('returns before-event decisions to the embedded editor', async () => {
    const onMessage = vi.fn().mockResolvedValue(false);
    const { iframe } = createAdapter({ onMessage });
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    dispatchMessage(iframe, 'https://docmee.cn', {
      data: { format: 'pptx' },
      type: 'beforeDownload',
    });

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { data: false, type: 'recover_beforeDownload' },
        'https://docmee.cn',
      );
    });
  });

  it('removes the iframe and message listener when destroyed', async () => {
    const onMessage = vi.fn();
    const { adapter, container, iframe } = createAdapter({ onMessage });

    adapter.destroy();
    dispatchMessage(iframe, 'https://docmee.cn', { type: 'error' });

    await Promise.resolve();
    expect(container.querySelector('iframe')).toBeNull();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('rejects unsafe URLs and editor sessions without a presentation id', () => {
    expect(() => createAdapter({ baseUrl: 'javascript:alert(1)' })).toThrow(
      'Docmee base URL must use HTTP or HTTPS',
    );
    expect(() => createAdapter({ page: 'editor', pptId: undefined })).toThrow(
      'A presentation id is required for the editor page',
    );
  });
});
