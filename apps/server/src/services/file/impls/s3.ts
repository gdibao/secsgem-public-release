import { createHash } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import urlJoin from 'url-join';

import { FileModel } from '@/database/models/file';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { FileS3 } from '@/server/modules/S3';
import { type ServerFileS3Config } from '@/server/services/appSettings';

import type { FileServiceImpl, PreSignedUpload } from './type';

const log = debug('lobe-file:s3');

const PRESIGNED_PREVIEW_CACHE_SAFETY_SECONDS = 60;
const PRESIGNED_PREVIEW_CACHE_MAX_SECONDS = 3600;
const PRESIGNED_PREVIEW_CACHE_KEY_PREFIX = 'file:presigned-preview:';

interface PresignedPreviewCacheEntry {
  expiresAt: number;
  url: string;
}

const presignedPreviewUrlCache = new Map<string, PresignedPreviewCacheEntry>();

const createPresignedPreviewCacheKey = (
  key: string,
  expiresIn: number,
  config: ServerFileS3Config,
) => {
  const configHash = createHash('sha256')
    .update(
      JSON.stringify([
        config.accessKeyId ?? '',
        config.secretAccessKey ?? '',
        config.endpoint ?? '',
        config.bucket ?? '',
        config.enablePathStyle,
        config.previewUrlExpireIn,
        config.publicDomain ?? '',
        config.region ?? '',
        config.setAcl,
      ]),
    )
    .digest('hex')
    .slice(0, 16);

  return `${PRESIGNED_PREVIEW_CACHE_KEY_PREFIX}${expiresIn}:${configHash}:${key}`;
};

const getPresignedPreviewCacheTtlSeconds = (expiresInSeconds: number) =>
  Math.min(
    Math.max(expiresInSeconds - PRESIGNED_PREVIEW_CACHE_SAFETY_SECONDS, 0),
    PRESIGNED_PREVIEW_CACHE_MAX_SECONDS,
  );

/**
 * S3-based file service implementation
 */
export class S3StaticFileImpl implements FileServiceImpl {
  private readonly s3: FileS3;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
    this.s3 = new FileS3();
  }

  async deleteFile(key: string) {
    return this.s3.deleteFile(key);
  }

  async deleteFiles(keys: string[]) {
    return this.s3.deleteFiles(keys);
  }

  async getFileContent(key: string, byteLength?: number): Promise<string> {
    return byteLength === undefined
      ? this.s3.getFileContent(key)
      : this.s3.getFileContent(key, byteLength);
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.s3.getFileByteArray(key);
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.s3.createPreSignedUrl(key);
  }

  async createPreSignedUpload(key: string): Promise<PreSignedUpload> {
    return this.s3.createPreSignedUpload(key);
  }

  async getFileMetadata(key: string): Promise<{ contentLength: number; contentType?: string }> {
    return this.s3.getFileMetadata(key);
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.s3.createPreSignedUrlForPreview(key, expiresIn);
  }

  async createPreSignedUrlForDownload(
    key: string,
    fileName: string,
    expiresIn?: number,
  ): Promise<string> {
    return this.s3.createPreSignedUrlForDownload(key, fileName, expiresIn);
  }

  private async getStorageKeyFromUrl(url: string): Promise<string> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

    const extractedKey = await this.getKeyFromFullUrl(url);
    if (!extractedKey) {
      throw new Error('Key not found from url: ' + url);
    }

    return extractedKey;
  }

  async createDownloadUrl(url: string, fileName: string, expiresIn?: number): Promise<string> {
    const key = await this.getStorageKeyFromUrl(url);

    return this.createPreSignedUrlForDownload(key, fileName, expiresIn);
  }

  private async getCachedPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    const config = await this.s3.getConfig();
    const expiresInSeconds = expiresIn ?? config.previewUrlExpireIn;
    const cacheKey = createPresignedPreviewCacheKey(key, expiresInSeconds, config);
    const ttlSeconds = getPresignedPreviewCacheTtlSeconds(expiresInSeconds);
    const now = Date.now();
    const cached = presignedPreviewUrlCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.url;
    }

    try {
      const redisConfig = getRedisConfig();
      const redis = isRedisEnabled(redisConfig) ? await initializeRedis(redisConfig) : null;
      const cachedUrl = await redis?.get(cacheKey);

      if (cachedUrl) {
        if (ttlSeconds > 0) {
          presignedPreviewUrlCache.set(cacheKey, {
            expiresAt: now + ttlSeconds * 1000,
            url: cachedUrl,
          });
        }

        return cachedUrl;
      }
    } catch (error) {
      log('Failed to read presigned preview URL cache from Redis: %O', error);
    }

    const url = await this.createPreSignedUrlForPreview(key, expiresIn);

    if (ttlSeconds > 0) {
      presignedPreviewUrlCache.set(cacheKey, {
        expiresAt: now + ttlSeconds * 1000,
        url,
      });

      try {
        const redisConfig = getRedisConfig();
        const redis = isRedisEnabled(redisConfig) ? await initializeRedis(redisConfig) : null;
        await redis?.set(cacheKey, url, { ex: ttlSeconds });
      } catch (error) {
        log('Failed to write presigned preview URL cache to Redis: %O', error);
      }
    }

    return url;
  }

  async createCachedPreSignedUrlForPreview(
    url?: string | null,
    expiresIn?: number,
  ): Promise<string> {
    if (!url) return '';

    const key = await this.getStorageKeyFromUrl(url);

    return await this.getCachedPreSignedUrlForPreview(key, expiresIn);
  }

  async uploadContent(path: string, content: string) {
    return this.s3.uploadContent(path, content);
  }

  async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    if (!url) return '';

    const key = await this.getStorageKeyFromUrl(url);

    // If bucket is not set public read, or S3_PUBLIC_DOMAIN is not configured,
    // reuse the same presigned preview URL briefly so repeated chat turns keep
    // stable media URLs and can reuse provider-side prefix caches.
    const config = await this.s3.getConfig();

    if (!config.setAcl || !config.publicDomain) {
      return await this.getCachedPreSignedUrlForPreview(key, expiresIn);
    }

    if (config.enablePathStyle) {
      return urlJoin(config.publicDomain, config.bucket!, key);
    }

    return urlJoin(config.publicDomain, key);
  }

  async getKeyFromFullUrl(url: string): Promise<string | null> {
    try {
      const urlObject = new URL(url);
      const { pathname } = urlObject;

      // Case 1: File proxy URL pattern /f/{fileId} - query database for S3 key
      if (pathname.startsWith('/f/')) {
        const fileId = pathname.slice(3); // Remove '/f/' prefix
        const file = await FileModel.getFileById(this.db, fileId);
        return file?.url ?? null;
      }

      // Case 2: Legacy S3 URL - extract key from pathname
      const config = await this.s3.getConfig();

      if (config.enablePathStyle) {
        if (!config.bucket) {
          return pathname.startsWith('/') ? pathname.slice(1) : pathname;
        }
        const bucketPrefix = `/${config.bucket}/`;
        if (pathname.startsWith(bucketPrefix)) {
          return pathname.slice(bucketPrefix.length);
        }
        return pathname.startsWith('/') ? pathname.slice(1) : pathname;
      }

      // Virtual-hosted-style: path is /<key>
      return pathname.slice(1);
    } catch {
      // If url is not a valid URL, return null
      return null;
    }
  }

  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    await this.s3.uploadMedia(key, buffer);
    return { key };
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
    await this.s3.uploadBuffer(key, buffer, contentType);
    return { key };
  }
}
