import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import urlJoin from 'url-join';
import { parse } from 'yaml';
import { z } from 'zod';

import { FetchCacheTag } from '@/const/cacheControl';
import {
  normalizeDesktopDownloadUrl,
  normalizeDesktopUpdateServerUrl,
  type DesktopUpdateServerUrlReason,
} from '@/const/desktopUpdate';

export type DesktopDownloadType = 'linux' | 'mac-arm' | 'mac-intel' | 'windows';
export type DesktopReleaseChannel = 'canary' | 'stable';
export type DesktopDiagnosticStatus = 'available' | 'missing' | 'unavailable';
export type DesktopDiagnosticReason =
  | DesktopUpdateServerUrlReason
  | 'installer-missing'
  | 'manifest-invalid'
  | 'manifest-request-failed'
  | 'manifest-too-large'
  | 'manifest-version-missing'
  | 'request-timeout';

export interface DesktopDownloadInfo {
  assetName: string;
  publishedAt?: string;
  tag: string;
  type: DesktopDownloadType;
  url: string;
  version: string;
}

export interface DesktopArtifactDiagnostic {
  assetName?: string;
  publishedAt?: string;
  reason?: DesktopDiagnosticReason;
  sha512?: string;
  size?: number;
  status: DesktopDiagnosticStatus;
  type: DesktopDownloadType;
  url?: string;
  version?: string;
}

export interface DesktopChannelDiagnostic {
  channel: DesktopReleaseChannel;
  platforms: Record<DesktopDownloadType, DesktopArtifactDiagnostic>;
  publishedAt?: string;
  status: 'degraded' | 'healthy' | 'unavailable';
  version?: string;
}

export interface DesktopReleaseDiagnostics {
  baseUrl: null | string;
  channels: DesktopChannelDiagnostic[];
  checkedAt: string;
  configured: boolean;
}

export interface DesktopReleaseDiagnosticsOptions {
  baseUrl?: null | string;
  channels?: DesktopReleaseChannel[];
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

type GithubReleaseAsset = {
  browser_download_url: string;
  name: string;
};

type GithubRelease = {
  assets: GithubReleaseAsset[];
  published_at?: string;
  tag_name: string;
};

const DESKTOP_MANIFEST_REFERENCE_BASE_URL = 'https://desktop-manifest.invalid/';

const desktopManifestReferenceSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const resolved = new URL(value, DESKTOP_MANIFEST_REFERENCE_BASE_URL).toString();
      return 'url' in normalizeDesktopDownloadUrl(resolved);
    } catch {
      return false;
    }
  });

const updateServerManifestFileSchema = z.object({
  sha512: z.string().optional(),
  size: z.number().finite().nonnegative().optional(),
  url: desktopManifestReferenceSchema,
});

const updateServerManifestSchema = z.object({
  files: z.array(updateServerManifestFileSchema).optional(),
  path: desktopManifestReferenceSchema.optional(),
  releaseDate: z.string().optional(),
  version: z.string().optional(),
});

type UpdateServerManifest = z.infer<typeof updateServerManifestSchema>;

const DESKTOP_MANIFEST_MAX_BYTES = 512 * 1024;
const DESKTOP_MANIFEST_TIMEOUT_MS = 5000;

class DesktopManifestError extends Error {
  constructor(public readonly code: DesktopDiagnosticReason) {
    super(code);
    this.name = 'DesktopManifestError';
  }
}

const getBasename = (pathname: string) => {
  const cleaned = pathname.split('?')[0] || '';
  const lastSlash = cleaned.lastIndexOf('/');
  return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
};

const getDiagnosticReason = (error: unknown): DesktopDiagnosticReason => {
  if (error instanceof DesktopManifestError) return error.code;

  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return 'request-timeout';
  if (/ssrf|private|not allowed/i.test(message)) return 'unsafe-url';

  return 'manifest-request-failed';
};

const fetchDesktopManifest: typeof fetch = (input, options) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  return ssrfSafeFetch(url, options, {
    allowIPAddressList: [],
    allowPrivateIPAddress: false,
    maxContentLength: DESKTOP_MANIFEST_MAX_BYTES + 1,
  });
};

const readResponseTextWithLimit = async (response: Response) => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > DESKTOP_MANIFEST_MAX_BYTES) {
    throw new DesktopManifestError('manifest-too-large');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let complete = false;
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return text + decoder.decode();
      }

      totalBytes += value.byteLength;
      if (totalBytes > DESKTOP_MANIFEST_MAX_BYTES) {
        throw new DesktopManifestError('manifest-too-large');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const buildTypeMatchers = (type: DesktopDownloadType) => {
  switch (type) {
    case 'mac-arm': {
      return [/-arm64\.dmg$/i, /-arm64-mac\.zip$/i, /-arm64\.zip$/i, /\.dmg$/i, /\.zip$/i];
    }
    case 'mac-intel': {
      return [/-x64\.dmg$/i, /-x64-mac\.zip$/i, /-x64\.zip$/i, /\.dmg$/i, /\.zip$/i];
    }
    case 'windows': {
      return [/-setup\.exe$/i, /\.exe$/i];
    }
    case 'linux': {
      return [/\.appimage$/i, /\.deb$/i, /\.rpm$/i, /\.snap$/i, /\.tar\.gz$/i];
    }
  }
};

export const resolveDesktopDownloadFromUrls = (options: {
  publishedAt?: string;
  tag: string;
  type: DesktopDownloadType;
  urls: string[];
  version: string;
}): DesktopDownloadInfo | null => {
  const matchers = buildTypeMatchers(options.type);

  const matchedUrl = matchers
    .map((matcher) => options.urls.find((url) => matcher.test(getBasename(url))))
    .find(Boolean);

  if (!matchedUrl) return null;

  return {
    assetName: getBasename(matchedUrl),
    publishedAt: options.publishedAt,
    tag: options.tag,
    type: options.type,
    url: matchedUrl,
    version: options.version,
  };
};

export const resolveDesktopDownload = (
  release: GithubRelease,
  type: DesktopDownloadType,
): DesktopDownloadInfo | null => {
  const tag = release.tag_name;
  const version = tag.replace(/^v/i, '');
  const matchers = buildTypeMatchers(type);

  const matchedAsset = matchers
    .map((matcher) => release.assets.find((asset) => matcher.test(asset.name)))
    .find(Boolean);

  if (!matchedAsset) return null;

  return {
    assetName: matchedAsset.name,
    publishedAt: release.published_at,
    tag,
    type,
    url: matchedAsset.browser_download_url,
    version,
  };
};

export const getLatestDesktopReleaseFromGithub = async (options?: {
  owner?: string;
  repo?: string;
  token?: string;
}): Promise<GithubRelease> => {
  const owner = options?.owner || 'lobehub';
  const repo = options?.repo || 'lobe-chat';
  const token = options?.token || process.env.GITHUB_TOKEN;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'lobehub-server',
    },
    next: { revalidate: 300, tags: [FetchCacheTag.DesktopRelease] },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub releases/latest request failed: ${res.status} ${text}`.trim());
  }

  return (await res.json()) as GithubRelease;
};

const fetchUpdateServerManifest = async (
  baseUrl: string,
  manifestName: string,
  options?: {
    cache?: boolean;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<UpdateServerManifest> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const requestInit =
    options?.cache === false
      ? ({ cache: 'no-store', signal: controller.signal } satisfies RequestInit)
      : ({
          next: { revalidate: 300, tags: [FetchCacheTag.DesktopRelease] },
          signal: controller.signal,
        } as RequestInit);

  const request = async () => {
    const res = await (options?.fetcher ?? fetchDesktopManifest)(urlJoin(baseUrl, manifestName), {
      ...requestInit,
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new DesktopManifestError('manifest-request-failed');
    }

    const text = await readResponseTextWithLimit(res);
    let parsed: unknown;
    try {
      parsed = parse(text) || {};
    } catch {
      throw new DesktopManifestError('manifest-invalid');
    }

    const manifest = updateServerManifestSchema.safeParse(parsed);
    if (!manifest.success) throw new DesktopManifestError('manifest-invalid');
    return manifest.data;
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new DesktopManifestError('request-timeout'));
      }, options?.timeoutMs ?? DESKTOP_MANIFEST_TIMEOUT_MS);
    });

    return await Promise.race([request(), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const normalizeManifestUrls = (baseUrl: string, manifest: UpdateServerManifest) => {
  const urls: string[] = [];
  const baseUrlWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const resolveReference = (value: string) => {
    const normalized = normalizeDesktopDownloadUrl(new URL(value, baseUrlWithSlash).toString());
    if ('reason' in normalized) throw new DesktopManifestError('manifest-invalid');
    return normalized.url;
  };

  for (const file of manifest.files || []) {
    if (!file?.url) continue;
    urls.push(resolveReference(file.url));
  }

  if (manifest.path) {
    urls.push(resolveReference(manifest.path));
  }

  return urls;
};

type ManifestResult =
  | { manifest: UpdateServerManifest; reason?: never }
  | { manifest?: never; reason: DesktopDiagnosticReason };

const readManifest = async (
  channelBaseUrl: string,
  manifestName: string,
  options: { fetcher: typeof fetch; timeoutMs: number },
): Promise<ManifestResult> => {
  try {
    return {
      manifest: await fetchUpdateServerManifest(channelBaseUrl, manifestName, {
        cache: false,
        ...options,
      }),
    };
  } catch (error) {
    return { reason: getDiagnosticReason(error) };
  }
};

const resolveManifestArtifact = (options: {
  baseUrl: string;
  manifest?: UpdateServerManifest;
  reason?: DesktopDiagnosticReason;
  type: DesktopDownloadType;
}): DesktopArtifactDiagnostic => {
  if (!options.manifest) {
    return {
      reason: options.reason || 'manifest-request-failed',
      status: 'unavailable',
      type: options.type,
    };
  }

  const version = options.manifest.version?.replace(/^v/i, '');
  if (!version) {
    return {
      reason: 'manifest-version-missing',
      status: 'unavailable',
      type: options.type,
    };
  }

  const resolved = resolveDesktopDownloadFromUrls({
    publishedAt: options.manifest.releaseDate,
    tag: `v${version}`,
    type: options.type,
    urls: normalizeManifestUrls(options.baseUrl, options.manifest),
    version,
  });
  if (!resolved) {
    return {
      publishedAt: options.manifest.releaseDate,
      reason: 'installer-missing',
      status: 'missing',
      type: options.type,
      version,
    };
  }

  const file = options.manifest.files?.find(({ url }) => getBasename(url) === resolved.assetName);

  return {
    ...resolved,
    sha512: file?.sha512,
    size: file?.size,
    status: 'available',
  };
};

const unavailableChannel = (
  channel: DesktopReleaseChannel,
  reason: DesktopDiagnosticReason,
): DesktopChannelDiagnostic => {
  const unavailable = (type: DesktopDownloadType): DesktopArtifactDiagnostic => ({
    reason,
    status: 'unavailable',
    type,
  });

  return {
    channel,
    platforms: {
      'linux': unavailable('linux'),
      'mac-arm': unavailable('mac-arm'),
      'mac-intel': unavailable('mac-intel'),
      'windows': unavailable('windows'),
    },
    status: 'unavailable',
  };
};

const getDesktopChannelDiagnostic = async (options: {
  baseUrl: string;
  channel: DesktopReleaseChannel;
  fetcher: typeof fetch;
  timeoutMs: number;
}): Promise<DesktopChannelDiagnostic> => {
  const channelBaseUrl = urlJoin(options.baseUrl, options.channel);
  const [windowsManifest, macManifest, linuxManifest] = await Promise.all([
    readManifest(channelBaseUrl, `${options.channel}.yml`, options),
    readManifest(channelBaseUrl, `${options.channel}-mac.yml`, options),
    readManifest(channelBaseUrl, `${options.channel}-linux.yml`, options),
  ]);
  const platforms: DesktopChannelDiagnostic['platforms'] = {
    'linux': resolveManifestArtifact({
      baseUrl: channelBaseUrl,
      manifest: linuxManifest.manifest,
      reason: linuxManifest.reason,
      type: 'linux',
    }),
    'mac-arm': resolveManifestArtifact({
      baseUrl: channelBaseUrl,
      manifest: macManifest.manifest,
      reason: macManifest.reason,
      type: 'mac-arm',
    }),
    'mac-intel': resolveManifestArtifact({
      baseUrl: channelBaseUrl,
      manifest: macManifest.manifest,
      reason: macManifest.reason,
      type: 'mac-intel',
    }),
    'windows': resolveManifestArtifact({
      baseUrl: channelBaseUrl,
      manifest: windowsManifest.manifest,
      reason: windowsManifest.reason,
      type: 'windows',
    }),
  };
  const artifacts = Object.values(platforms);
  const availableCount = artifacts.filter(({ status }) => status === 'available').length;
  const versions = new Set(artifacts.map(({ version }) => version).filter(Boolean));

  return {
    channel: options.channel,
    platforms,
    publishedAt: artifacts.find(({ publishedAt }) => publishedAt)?.publishedAt,
    status:
      availableCount === artifacts.length && versions.size === 1
        ? 'healthy'
        : availableCount === 0
          ? 'unavailable'
          : 'degraded',
    version: artifacts.find(({ version }) => version)?.version,
  };
};

export const getDesktopReleaseDiagnostics = async (
  options: DesktopReleaseDiagnosticsOptions = {},
): Promise<DesktopReleaseDiagnostics> => {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const rawBaseUrl = options.baseUrl?.trim().replace(/\/+$/, '') || null;
  if (!rawBaseUrl) {
    return { baseUrl: null, channels: [], checkedAt, configured: false };
  }

  const channels = options.channels ?? ['stable', 'canary'];
  const normalizedBaseUrl = normalizeDesktopUpdateServerUrl(rawBaseUrl);
  if ('reason' in normalizedBaseUrl) {
    return {
      baseUrl: null,
      channels: channels.map((channel) => unavailableChannel(channel, normalizedBaseUrl.reason)),
      checkedAt,
      configured: true,
    };
  }

  return {
    baseUrl: normalizedBaseUrl.url,
    channels: await Promise.all(
      channels.map((channel) =>
        getDesktopChannelDiagnostic({
          baseUrl: normalizedBaseUrl.url,
          channel,
          fetcher: options.fetcher ?? fetchDesktopManifest,
          timeoutMs: options.timeoutMs ?? 5000,
        }),
      ),
    ),
    checkedAt,
    configured: true,
  };
};

export const getStableDesktopReleaseInfoFromUpdateServer = async (options?: {
  baseUrl?: string;
}): Promise<{ publishedAt?: string; tag: string; urls: string[]; version: string } | null> => {
  const baseUrl =
    options?.baseUrl || process.env.DESKTOP_UPDATE_SERVER_URL || process.env.UPDATE_SERVER_URL;
  if (!baseUrl) return null;

  const normalizedBaseUrl = normalizeDesktopUpdateServerUrl(baseUrl);
  if ('reason' in normalizedBaseUrl) return null;

  const timestamp = Date.now();
  const channelBaseUrl = urlJoin(normalizedBaseUrl.url, 'stable');
  const fetchOptions = { timeoutMs: DESKTOP_MANIFEST_TIMEOUT_MS };

  const [mac, win, linux] = await Promise.all([
    fetchUpdateServerManifest(channelBaseUrl, 'stable-mac.yml?t=' + timestamp, fetchOptions).catch(
      () => null,
    ),
    fetchUpdateServerManifest(channelBaseUrl, 'stable.yml?t=' + timestamp, fetchOptions).catch(
      () => null,
    ),
    fetchUpdateServerManifest(
      channelBaseUrl,
      'stable-linux.yml?t=' + timestamp,
      fetchOptions,
    ).catch(() => null),
  ]);

  const manifests = [mac, win, linux].filter(Boolean) as UpdateServerManifest[];
  const version = manifests.map((m) => m.version).find(Boolean) || '';
  if (!version) return null;

  const tag = `v${version.replace(/^v/i, '')}`;
  const publishedAt = manifests.map((m) => m.releaseDate).find(Boolean);

  const urls = [
    ...(mac ? normalizeManifestUrls(channelBaseUrl, mac) : []),
    ...(win ? normalizeManifestUrls(channelBaseUrl, win) : []),
    ...(linux ? normalizeManifestUrls(channelBaseUrl, linux) : []),
  ];

  return { publishedAt, tag, urls, version: version.replace(/^v/i, '') };
};

export const resolveDesktopDownloadFromUpdateServer = async (options: {
  baseUrl?: string;
  type: DesktopDownloadType;
}): Promise<DesktopDownloadInfo | null> => {
  const info = await getStableDesktopReleaseInfoFromUpdateServer({ baseUrl: options.baseUrl });
  if (!info) return null;

  return resolveDesktopDownloadFromUrls({ ...info, type: options.type });
};
