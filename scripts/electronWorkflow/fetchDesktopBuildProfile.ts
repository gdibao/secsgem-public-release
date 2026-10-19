import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_PROFILE_RESPONSE_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const assetFiles = {
  appPreview: 'app-preview.png',
  nsisHeader: 'nsis-header.bmp',
  nsisSidebar: 'nsis-sidebar.bmp',
  windowsIcon: 'windows-icon.ico',
} as const;

type AssetKind = keyof typeof assetFiles;
type ProfileResponse = {
  assets: Record<AssetKind, { contentType: string; sha256: string; size: number; url: string }>;
  profileRevision: { id: string; payload: Record<string, unknown>; state: 'frozen' };
  releaseId: string;
};

type StageDesktopBuildProfileInput = {
  appUrl: string;
  fetcher?: typeof fetch;
  outputDir: string;
  releaseId: string;
  token: string;
};

const stageError = (code: string): never => {
  throw new Error(code);
};

const cancelResponseBody = async (response: Response) => {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the staging error when response cleanup itself fails.
  }
};

const parseContentLength = (response: Response) => {
  const value = response.headers.get('content-length');
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return stageError('DESKTOP_BUILD_PROFILE_INVALID_CONTENT_LENGTH');
  return Number(value);
};

const readResponseBytes = async (response: Response, limit: number) => {
  let contentLength: number | undefined;
  try {
    contentLength = parseContentLength(response);
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  if (contentLength !== undefined && contentLength > limit) {
    await cancelResponseBody(response);
    return stageError('DESKTOP_BUILD_PROFILE_ASSET_TOO_LARGE');
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the byte-limit error when stream cleanup itself fails.
        }
        return stageError('DESKTOP_BUILD_PROFILE_ASSET_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const fetchAsset = async (url: string, fetcher: typeof fetch) => {
  let current = new URL(url);
  if (current.protocol !== 'https:') return stageError('DESKTOP_BUILD_PROFILE_ASSET_URL_INVALID');

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetcher(current, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        return stageError('DESKTOP_BUILD_PROFILE_ASSET_REDIRECT_INVALID');
      }
      current = new URL(location, current);
      if (current.protocol !== 'https:')
        return stageError('DESKTOP_BUILD_PROFILE_ASSET_REDIRECT_INVALID');
      continue;
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return stageError('DESKTOP_BUILD_PROFILE_ASSET_DOWNLOAD_FAILED');
    }
    return response;
  }

  return stageError('DESKTOP_BUILD_PROFILE_ASSET_REDIRECT_INVALID');
};

const parseProfile = (value: unknown, releaseId: string): ProfileResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return stageError('DESKTOP_BUILD_PROFILE_INVALID');
  }
  const profile = value as Partial<ProfileResponse>;
  if (
    profile.releaseId !== releaseId ||
    !profile.profileRevision ||
    profile.profileRevision.state !== 'frozen' ||
    typeof profile.profileRevision.id !== 'string' ||
    !profile.profileRevision.payload ||
    typeof profile.profileRevision.payload !== 'object' ||
    !profile.assets ||
    typeof profile.assets !== 'object'
  ) {
    return stageError('DESKTOP_BUILD_PROFILE_INVALID');
  }

  for (const kind of Object.keys(assetFiles) as AssetKind[]) {
    const asset = profile.assets[kind];
    if (!asset) return stageError('DESKTOP_BUILD_PROFILE_ASSET_MISSING');
    if (
      typeof asset.url !== 'string' ||
      typeof asset.contentType !== 'string' ||
      asset.contentType.length === 0 ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_ASSET_BYTES ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(asset.sha256)
    ) {
      return stageError('DESKTOP_BUILD_PROFILE_INVALID');
    }
  }
  return profile as ProfileResponse;
};

const confinedPath = (outputDir: string, fileName: string) => {
  const root = path.resolve(outputDir);
  const target = path.resolve(root, fileName);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return stageError('DESKTOP_BUILD_PROFILE_OUTPUT_PATH_INVALID');
  }
  return target;
};

const atomicWrite = async (target: string, bytes: Uint8Array | string) => {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
};

export const stageDesktopBuildProfile = async ({
  appUrl,
  fetcher = fetch,
  outputDir,
  releaseId,
  token,
}: StageDesktopBuildProfileInput) => {
  const profileUrl = new URL(
    `/api/admin/desktop-release/${encodeURIComponent(releaseId)}/profile`,
    appUrl,
  );
  if (profileUrl.protocol !== 'https:') return stageError('DESKTOP_BUILD_PROFILE_APP_URL_INVALID');
  const response = await fetcher(profileUrl, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  if (!response.ok) {
    await cancelResponseBody(response);
    return stageError('DESKTOP_BUILD_PROFILE_FETCH_FAILED');
  }
  const profile = parseProfile(
    JSON.parse(
      new TextDecoder().decode(await readResponseBytes(response, MAX_PROFILE_RESPONSE_BYTES)),
    ),
    releaseId,
  );

  const root = path.resolve(outputDir);
  await mkdir(root, { recursive: true });
  const writtenPaths: string[] = [];
  try {
    const stagedAssets = {} as Record<AssetKind, string>;
    for (const kind of Object.keys(assetFiles) as AssetKind[]) {
      const asset = profile.assets[kind];
      const assetResponse = await fetchAsset(asset.url, fetcher);
      let contentLength: number | undefined;
      try {
        contentLength = parseContentLength(assetResponse);
      } catch (error) {
        await cancelResponseBody(assetResponse);
        throw error;
      }
      if (contentLength !== undefined && contentLength !== asset.size) {
        await cancelResponseBody(assetResponse);
        return stageError(
          contentLength > asset.size
            ? 'DESKTOP_BUILD_PROFILE_ASSET_TOO_LARGE'
            : 'DESKTOP_BUILD_PROFILE_ASSET_SIZE_MISMATCH',
        );
      }
      const bytes = await readResponseBytes(assetResponse, asset.size);
      if (bytes.byteLength !== asset.size)
        return stageError('DESKTOP_BUILD_PROFILE_ASSET_SIZE_MISMATCH');
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256.toLowerCase()) {
        return stageError('DESKTOP_BUILD_PROFILE_ASSET_CHECKSUM_MISMATCH');
      }
      const target = confinedPath(root, assetFiles[kind]);
      await atomicWrite(target, bytes);
      writtenPaths.push(target);
      stagedAssets[kind] = target;
    }

    const profilePath = confinedPath(root, 'desktop-build-profile.json');
    await atomicWrite(
      profilePath,
      JSON.stringify({
        assets: stagedAssets,
        profile: profile.profileRevision.payload,
        profileRevisionId: profile.profileRevision.id,
        releaseId: profile.releaseId,
      }),
    );
    writtenPaths.push(profilePath);
    return profilePath;
  } catch (error) {
    await Promise.all(writtenPaths.map((file) => rm(file, { force: true })));
    throw error;
  }
};

const run = async () => {
  const [appUrl, outputDir, releaseId] = process.argv.slice(2);
  const token = process.env.DESKTOP_RELEASE_TOKEN;
  if (!appUrl || !outputDir || !releaseId || !token) {
    return stageError('DESKTOP_BUILD_PROFILE_ARGUMENTS_INVALID');
  }
  process.stdout.write(
    `${await stageDesktopBuildProfile({ appUrl, outputDir, releaseId, token })}\n`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run();
}
