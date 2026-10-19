import type { ModuleAppActionConfig } from '@lobechat/types';
import type { Dispatcher } from 'undici';

import { redactResolvedModuleAppSecretValues } from '../logRedaction';
import { renderModuleAppTemplateString, renderModuleAppTemplateValue } from '../runtimeTemplate';
import {
  createModuleAppPinnedDispatcher,
  type ModuleAppDispatcherFactory,
  type ModuleAppUrlResolver,
  resolveSafeModuleAppApiUrl,
} from '../safeUrl';

type FetchResponse = {
  body?: null | ReadableStream<Uint8Array>;
  headers?: { get: (name: string) => string | null };
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
};

type ModuleAppFetchInit = RequestInit & { dispatcher?: Dispatcher };

export type ModuleAppFetch = (input: string, init: ModuleAppFetchInit) => Promise<FetchResponse>;

export type ModuleAppRunnerArtifactRequest = {
  content: Buffer | string;
  expiresAt?: Date | null;
  fileName: string;
  mimeType: string;
};

export type ModuleAppRunnerResult = {
  actualAiCredits: number;
  artifacts: ModuleAppRunnerArtifactRequest[];
  output: Record<string, unknown>;
  preview: string;
};

export interface RunModuleAppApiActionInput {
  action: ModuleAppActionConfig;
  createDispatcher?: ModuleAppDispatcherFactory;
  fetchImpl?: ModuleAppFetch;
  input: Record<string, unknown>;
  outboundHosts?: string[];
  resolvedSecrets?: Record<string, string>;
  resolveHostname?: ModuleAppUrlResolver;
}

const MODULE_APP_API_MAX_BODY_BYTES = 256 * 1024;
const MODULE_APP_API_MAX_RESPONSE_BYTES = 1024 * 1024;
const MODULE_APP_API_MAX_HEADERS = 32;
const MODULE_APP_API_MAX_HEADER_VALUE_BYTES = 4096;
const forbiddenTransportHeaders = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const getStringConfig = (config: Record<string, unknown>, key: string) => {
  const value = config[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getNumberConfig = (config: Record<string, unknown>, key: string, fallback: number) => {
  const value = config[key];

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
};

const getMethodConfig = (config: Record<string, unknown>) => {
  const method = getStringConfig(config, 'method')?.toUpperCase();

  return method === 'GET' ? 'GET' : 'POST';
};

const getHeadersConfig = (config: Record<string, unknown>) => {
  const value = config.headers;

  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === 'string')
      .map(([key, entry]) => [key, entry as string]),
  );
};

const buildHeaders = (headers: Record<string, string>, values: Record<string, unknown>) => {
  const entries = Object.entries(headers);
  if (entries.length > MODULE_APP_API_MAX_HEADERS) {
    throw new Error('MODULE_APP_API_HEADERS_INVALID');
  }

  const names = new Set<string>();
  return Object.fromEntries(
    entries.map(([key, template]) => {
      const normalized = key.toLowerCase();
      const value = renderModuleAppTemplateString(template, values);
      if (
        names.has(normalized) ||
        !/^[a-z0-9-]{1,80}$/.test(normalized) ||
        forbiddenTransportHeaders.has(normalized) ||
        /[\r\n]/.test(value) ||
        new TextEncoder().encode(value).byteLength > MODULE_APP_API_MAX_HEADER_VALUE_BYTES
      ) {
        throw new Error('MODULE_APP_API_HEADERS_INVALID');
      }
      names.add(normalized);
      return [key, value];
    }),
  );
};

const normalizeReviewedHost = (value: string) => {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('MODULE_APP_API_OUTBOUND_HOSTS_INVALID');

  let parsed: URL;
  try {
    parsed = new URL(`https://${host}`);
  } catch {
    throw new Error('MODULE_APP_API_OUTBOUND_HOSTS_INVALID');
  }
  const normalizedHostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    normalizedHostname !== host ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('MODULE_APP_API_OUTBOUND_HOSTS_INVALID');
  }
  return normalizedHostname;
};

const getReviewedHosts = (outboundHosts?: string[]) => {
  const hosts = outboundHosts ?? [];
  if (hosts.length > 80) throw new Error('MODULE_APP_API_OUTBOUND_HOSTS_INVALID');
  return new Set(hosts.map(normalizeReviewedHost));
};

const ensureJsonContentType = (headers: Record<string, string>) => {
  if (Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) return;
  if (Object.keys(headers).length >= MODULE_APP_API_MAX_HEADERS) {
    throw new Error('MODULE_APP_API_HEADERS_INVALID');
  }
  headers['Content-Type'] = 'application/json';
};

const getByPath = (value: unknown, path?: string) => {
  if (!path) return value;

  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;

    return (current as Record<string, unknown>)[segment];
  }, value);
};

const stringifyPreview = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';

  return JSON.stringify(value);
};

const readBoundedResponseText = async (response: FetchResponse) => {
  const declaredLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MODULE_APP_API_MAX_RESPONSE_BYTES) {
    throw new Error('MODULE_APP_API_RESPONSE_TOO_LARGE');
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MODULE_APP_API_MAX_RESPONSE_BYTES) {
      throw new Error('MODULE_APP_API_RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MODULE_APP_API_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('MODULE_APP_API_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const parseResponseBody = async (response: FetchResponse) => {
  const text = await readBoundedResponseText(response);
  const contentType = response.headers?.get('content-type') ?? '';

  if (contentType.toLowerCase().includes('json')) {
    return text ? JSON.parse(text) : null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const runModuleAppApiAction = async ({
  action,
  createDispatcher = createModuleAppPinnedDispatcher,
  fetchImpl = fetch as unknown as ModuleAppFetch,
  input,
  outboundHosts,
  resolvedSecrets = {},
  resolveHostname,
}: RunModuleAppApiActionInput): Promise<ModuleAppRunnerResult> => {
  const config = action.runtimeConfig;
  const configuredUrl = getStringConfig(config, 'url') ?? getStringConfig(config, 'endpoint');

  if (action.runtimeType !== 'api_action' || !configuredUrl) {
    throw new Error('MODULE_APP_API_ACTION_NOT_CONFIGURED');
  }

  const values = { ...input, ...resolvedSecrets };
  const renderedUrl = renderModuleAppTemplateString(configuredUrl, values);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(renderedUrl);
  } catch {
    throw new Error('MODULE_APP_UNSAFE_API_URL');
  }
  if (Object.keys(resolvedSecrets).length > 0 && parsedUrl.protocol !== 'https:') {
    throw new Error('MODULE_APP_API_SECRET_REQUIRES_HTTPS');
  }
  const reviewedHosts = getReviewedHosts(outboundHosts);
  if (!reviewedHosts.has(parsedUrl.hostname.toLowerCase().replace(/\.$/, ''))) {
    throw new Error('MODULE_APP_API_HOST_DENIED');
  }
  const resolvedUrl = await resolveSafeModuleAppApiUrl(renderedUrl, { resolveHostname });
  const url = resolvedUrl.url;
  const method = getMethodConfig(config);
  const headers = buildHeaders(getHeadersConfig(config), values);
  const init: ModuleAppFetchInit = { headers, method };

  if (method === 'POST') {
    const bodyTemplate = config.bodyTemplate ?? input;
    const body = renderModuleAppTemplateValue(bodyTemplate, values);
    init.body = JSON.stringify(body);
    if (new TextEncoder().encode(init.body).byteLength > MODULE_APP_API_MAX_BODY_BYTES) {
      throw new Error('MODULE_APP_API_BODY_TOO_LARGE');
    }
    ensureJsonContentType(headers);
  }

  const dispatcher = createDispatcher(resolvedUrl);
  init.dispatcher = dispatcher;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getNumberConfig(config, 'timeoutMs', 30_000),
  );
  init.signal = controller.signal;
  init.redirect = 'error';

  try {
    const response = await fetchImpl(url, init);
    const responseBody = await parseResponseBody(response);
    const selectedValue = getByPath(responseBody, getStringConfig(config, 'responsePath'));
    const output = {
      request: redactResolvedModuleAppSecretValues(
        {
          body: method === 'POST' ? init.body : undefined,
          headers,
          method,
          url,
        },
        resolvedSecrets,
      ),
      response: redactResolvedModuleAppSecretValues(
        {
          body: responseBody,
          status: response.status,
        },
        resolvedSecrets,
      ),
    };

    if (!response.ok) {
      throw new Error(`MODULE_APP_API_REQUEST_FAILED:${response.status}`);
    }

    return {
      actualAiCredits: 0,
      artifacts: [],
      output,
      preview: stringifyPreview(selectedValue),
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
};
