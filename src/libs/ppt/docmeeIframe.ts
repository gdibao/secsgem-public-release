const DOCMEE_EVENT_NAMES = [
  'afterCreateCustomTemplate',
  'afterGenerate',
  'beforeCreateCustomTemplate',
  'beforeCreatePpt',
  'beforeDownload',
  'beforeGenerate',
  'changeSlideIndex',
  'charge',
  'error',
  'invalid-token',
  'manuallySavePPT',
  'mounted',
  'pageChange',
  'pptxRenamed',
  'toggleGenerateMode',
  'user-info',
] as const;

const DOCMEE_EVENT_NAME_SET = new Set<string>(DOCMEE_EVENT_NAMES);

const DOCMEE_PAGE_PATHS = {
  'creator': 'sdk-ui/creator/0',
  'creator-v2': 'sdk-ui/creator-v2',
  'editor': 'sdk-ui/editor',
} as const;

const HANDSHAKE_RETRY_DELAYS = [200, 400, 800, 1600, 3200] as const;

export type DocmeeEventName = (typeof DOCMEE_EVENT_NAMES)[number];
export type DocmeePage = keyof typeof DOCMEE_PAGE_PATHS;

export interface DocmeeIframeEvent {
  data?: unknown;
  type: DocmeeEventName;
}

type DocmeeEventResult = unknown | Promise<unknown>;
type DocmeeEventListener = (event: DocmeeIframeEvent) => DocmeeEventResult;

export interface DocmeeIframeOptions {
  baseUrl: string;
  container: HTMLElement;
  creatorVersion?: 'v1' | 'v2';
  downloadButton?: false | Array<'pdf' | 'pptx'>;
  isMobile?: boolean;
  lang?: string;
  mode?: 'dark' | 'light';
  onMessage?: DocmeeEventListener;
  page: DocmeePage;
  pptId?: string;
  token: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseDocmeeEvent = (value: unknown): DocmeeIframeEvent | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return;
  if (!DOCMEE_EVENT_NAME_SET.has(value.type)) return;

  return Object.hasOwn(value, 'data')
    ? { data: value.data, type: value.type as DocmeeEventName }
    : { type: value.type as DocmeeEventName };
};

const createIframeUrl = (baseUrl: string, page: DocmeePage) => {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Docmee base URL must use HTTP or HTTPS');
  }

  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';

  return new URL(DOCMEE_PAGE_PATHS[page], url);
};

export class DocmeeIframeAdapter {
  private readonly container: HTMLElement;
  private destroyed = false;
  private handshakeTimers: number[] = [];
  private readonly iframe: HTMLIFrameElement;
  private iframeMounted = false;
  private readonly listeners = new Map<DocmeeEventName, Set<DocmeeEventListener>>();
  private readonly onMessage?: DocmeeEventListener;
  private readonly runtimeParams: Record<string, unknown>;
  private readonly targetOrigin: string;

  constructor(options: DocmeeIframeOptions) {
    if (options.page === 'editor' && !options.pptId) {
      throw new Error('A presentation id is required for the editor page');
    }

    const iframeUrl = createIframeUrl(options.baseUrl, options.page);
    this.container = options.container;
    this.onMessage = options.onMessage;
    this.targetOrigin = iframeUrl.origin;
    this.runtimeParams = {
      iframe: '1',
      token: options.token,
      ...(options.creatorVersion ? { creatorVersion: options.creatorVersion } : {}),
      ...(options.downloadButton === undefined ? {} : { downloadButton: options.downloadButton }),
      ...(options.isMobile === undefined ? {} : { isMobile: options.isMobile }),
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.pptId ? { pptId: options.pptId } : {}),
    };

    const iframe = document.createElement('iframe');
    iframe.src = iframeUrl.toString();
    iframe.style.border = '0';
    iframe.style.height = '100%';
    iframe.style.outline = 'none';
    iframe.style.padding = '0';
    iframe.style.width = '100%';
    iframe.title = 'PPT editor';
    iframe.setAttribute(
      'allow',
      'fullscreen *; clipboard-read; clipboard-write; payment; cross-origin-isolated',
    );
    iframe.addEventListener('load', this.handleIframeLoad);
    this.iframe = iframe;

    window.addEventListener('message', this.handleWindowMessage);
    this.container.replaceChildren(iframe);
  }

  on(eventName: DocmeeEventName, listener: DocmeeEventListener) {
    const listeners = this.listeners.get(eventName) ?? new Set<DocmeeEventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);

    return () => {
      listeners.delete(listener);
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearHandshakeTimers();
    window.removeEventListener('message', this.handleWindowMessage);
    this.iframe.removeEventListener('load', this.handleIframeLoad);
    this.iframe.remove();
    this.listeners.clear();
  }

  private clearHandshakeTimers = () => {
    for (const timer of this.handshakeTimers) window.clearTimeout(timer);
    this.handshakeTimers = [];
  };

  private handleIframeLoad = () => {
    this.clearHandshakeTimers();
    this.transferRuntimeParams();

    this.handshakeTimers = HANDSHAKE_RETRY_DELAYS.map((delay) =>
      window.setTimeout(() => {
        if (!this.destroyed && !this.iframeMounted) this.transferRuntimeParams();
      }, delay),
    );
  };

  private handleWindowMessage = (event: MessageEvent) => {
    if (this.destroyed) return;
    if (event.source !== this.iframe.contentWindow || event.origin !== this.targetOrigin) return;

    const message = parseDocmeeEvent(event.data);
    if (!message) return;

    void this.dispatchMessage(message);
  };

  private dispatchMessage = async (message: DocmeeIframeEvent) => {
    if (
      message.type === 'mounted' ||
      message.type === 'invalid-token' ||
      message.type === 'user-info'
    ) {
      this.iframeMounted = true;
      this.clearHandshakeTimers();
    }
    if (message.type === 'mounted') this.transferRuntimeParams();

    let response: unknown;
    try {
      response = await this.onMessage?.(message);
    } catch {
      response = undefined;
    }

    for (const listener of this.listeners.get(message.type) ?? []) {
      try {
        const listenerResponse = await listener(message);
        if (listenerResponse !== undefined) response = listenerResponse;
      } catch {
        continue;
      }
    }

    if (message.type.startsWith('before')) {
      this.postMessage({
        data: response === undefined ? true : response,
        type: `recover_${message.type}`,
      });
    }
  };

  private postMessage = (message: Record<string, unknown>) => {
    if (this.destroyed) return;
    this.iframe.contentWindow?.postMessage(message, this.targetOrigin);
  };

  private transferRuntimeParams = () => {
    this.postMessage({ data: this.runtimeParams, type: 'transParams' });
  };
}
