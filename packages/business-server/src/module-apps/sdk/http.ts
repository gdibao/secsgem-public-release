import type { ModuleAppCapabilityClaims } from '@lobechat/types';
import type { Dispatcher } from 'undici';

import {
  createModuleAppPinnedDispatcher,
  type ModuleAppDispatcherFactory,
  type ModuleAppUrlResolver,
  resolveSafeModuleAppApiUrl,
} from '../safeUrl';
import type { ModuleAppGatewayContext } from './context';

const MODULE_APP_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;
const MODULE_APP_HTTP_TIMEOUT_MS = 15_000;

type FetchLike = (
  input: string,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => Promise<Response>;

type ModuleAppHttpInput = {
  body?: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  url: string;
};

const parseInput = (input: unknown): ModuleAppHttpInput => {
  if (!input || typeof input !== 'object' || !('url' in input) || typeof input.url !== 'string') {
    throw new Error('MODULE_APP_HTTP_INPUT_INVALID');
  }

  const value = input as ModuleAppHttpInput;
  if (value.method && value.method !== 'GET' && value.method !== 'POST') {
    throw new Error('MODULE_APP_HTTP_METHOD_DENIED');
  }
  if (value.body && value.body.length > 256 * 1024) {
    throw new Error('MODULE_APP_HTTP_BODY_TOO_LARGE');
  }

  return value;
};

const sanitizeHeaders = (headers: Record<string, string> = {}) => {
  const entries = Object.entries(headers);
  if (entries.length > 32) throw new Error('MODULE_APP_HTTP_HEADERS_INVALID');

  return Object.fromEntries(
    entries.map(([key, value]) => {
      const normalized = key.toLowerCase();
      if (
        !/^[a-z0-9-]{1,80}$/.test(normalized) ||
        value.length > 4096 ||
        ['connection', 'cookie', 'host', 'proxy-authorization', 'transfer-encoding'].includes(
          normalized,
        )
      ) {
        throw new Error('MODULE_APP_HTTP_HEADERS_INVALID');
      }
      return [normalized, value];
    }),
  );
};

const readBoundedResponse = async (response: Response) => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MODULE_APP_HTTP_MAX_RESPONSE_BYTES) {
    throw new Error('MODULE_APP_HTTP_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MODULE_APP_HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('MODULE_APP_HTTP_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export class ModuleAppHttpGateway {
  private readonly createDispatcher: ModuleAppDispatcherFactory;
  private readonly fetch: FetchLike;
  private readonly resolveHostname?: ModuleAppUrlResolver;

  constructor(
    options: {
      createDispatcher?: ModuleAppDispatcherFactory;
      fetch?: FetchLike;
      resolveHostname?: ModuleAppUrlResolver;
    } = {},
  ) {
    this.createDispatcher = options.createDispatcher ?? createModuleAppPinnedDispatcher;
    this.fetch = options.fetch ?? fetch;
    this.resolveHostname = options.resolveHostname;
  }

  request = async (
    _capability: ModuleAppCapabilityClaims,
    context: ModuleAppGatewayContext,
    input: unknown,
  ) => {
    const value = parseInput(input);
    let parsed: URL;
    try {
      parsed = new URL(value.url);
    } catch {
      throw new Error('MODULE_APP_UNSAFE_API_URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('MODULE_APP_HTTP_HTTPS_REQUIRED');
    const reviewedHosts = new Set(context.outboundHosts.map((host) => host.toLowerCase()));
    if (!reviewedHosts.has(parsed.hostname.toLowerCase())) {
      throw new Error('MODULE_APP_HTTP_HOST_DENIED');
    }

    const resolvedUrl = await resolveSafeModuleAppApiUrl(value.url, {
      resolveHostname: this.resolveHostname,
    });
    const headers = sanitizeHeaders(value.headers);
    const dispatcher = this.createDispatcher(resolvedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODULE_APP_HTTP_TIMEOUT_MS);

    try {
      const response = await this.fetch(resolvedUrl.url, {
        body: value.method === 'POST' ? value.body : undefined,
        dispatcher,
        headers,
        method: value.method ?? 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      const bytes = await readBoundedResponse(response);

      return {
        body: new TextDecoder().decode(bytes),
        contentType: response.headers.get('content-type') ?? undefined,
        status: response.status,
      };
    } finally {
      clearTimeout(timeout);
      await dispatcher.close();
    }
  };
}
