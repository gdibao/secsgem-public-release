import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  paginateListParts,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mime from 'mime';
import { z } from 'zod';

import { fileEnv } from '@/envs/file';
import { getServerFileS3Config, type ServerFileS3Config } from '@/server/services/appSettings';
import { YEAR } from '@/utils/units';

export const fileSchema = z.object({
  Key: z.string(),
  LastModified: z.date(),
  Size: z.number(),
});

export const listFileSchema = z.array(fileSchema);

export type FileType = z.infer<typeof fileSchema>;

const DEFAULT_S3_REGION = 'us-east-1';
const PUBLIC_READ_ACL_HEADER = 'public-read';
const DELETE_OBJECTS_MAX_KEYS = 1000;

const encodeContentDispositionFilename = (fileName: string) =>
  encodeURIComponent(fileName || 'download').replaceAll(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface PreSignedUpload {
  headers?: Record<string, string>;
  url: string;
}

export class S3 {
  /** Sends server-side requests through the internal endpoint when configured. */
  private readonly client: S3Client;

  /** Signs URLs with the public endpoint that browsers and model providers can reach. */
  private readonly presignClient: S3Client;

  private readonly bucket: string;

  private readonly setAcl: boolean;

  private readonly previewUrlExpireIn: number;

  constructor(
    accessKeyId: string | undefined,
    secretAccessKey: string | undefined,
    endpoint: string | undefined,
    options?: {
      bucket?: string;
      forcePathStyle?: boolean;
      internalEndpoint?: string;
      previewUrlExpireIn?: number;
      region?: string;
      setAcl?: boolean;
    },
  ) {
    if (!accessKeyId || !secretAccessKey || !endpoint)
      throw new Error('S3 environment variables are not set completely, please check your env');
    if (!options?.bucket) throw new Error('S3 bucket is not set, please check your env');

    this.bucket = options?.bucket;
    this.setAcl = options?.setAcl || false;
    this.previewUrlExpireIn = options?.previewUrlExpireIn || fileEnv.S3_PREVIEW_URL_EXPIRE_IN;

    const createClient = (clientEndpoint: string) =>
      new S3Client({
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint: clientEndpoint,
        forcePathStyle: options?.forcePathStyle,
        region: options?.region || DEFAULT_S3_REGION,
        // refs: https://github.com/lobehub/lobe-chat/pull/5479
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

    const internalEndpoint = options?.internalEndpoint;
    this.presignClient = createClient(endpoint);
    this.client =
      internalEndpoint && internalEndpoint !== endpoint
        ? createClient(internalEndpoint)
        : this.presignClient;
  }

  public async deleteFile(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return this.client.send(command);
  }

  public async deleteFiles(keys: string[]) {
    const batches: string[][] = [];
    for (let index = 0; index < keys.length; index += DELETE_OBJECTS_MAX_KEYS) {
      batches.push(keys.slice(index, index + DELETE_OBJECTS_MAX_KEYS));
    }
    if (batches.length === 0) batches.push([]);

    const results = [];
    for (const batch of batches) {
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })) },
      });
      results.push(await this.client.send(command));
    }

    return results.at(-1)!;
  }

  public async getFileContent(key: string, byteLength?: number): Promise<string> {
    const boundedLength = byteLength ? Math.max(1, Math.floor(byteLength)) : undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(boundedLength ? { Range: `bytes=0-${boundedLength - 1}` } : {}),
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response with ${key}`);
    }

    return response.Body.transformToString();
  }

  public async getFileByteArray(key: string): Promise<Uint8Array> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response with ${key}`);
    }

    return response.Body.transformToByteArray();
  }

  /**
   * Get file metadata from S3 using HeadObject
   * This is used to verify actual file size from S3 instead of trusting client-provided values
   */
  public async getFileMetadata(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType,
    };
  }

  public async testConnection() {
    const command = new HeadBucketCommand({
      Bucket: this.bucket,
    });

    await this.client.send(command);
  }

  public async createPreSignedUrl(key: string, contentLength?: number): Promise<string> {
    const upload = await this.createPreSignedUpload(key, contentLength);
    return upload.url;
  }

  private async createPreSignedUploadWithAcl(
    key: string,
    acl?: typeof PUBLIC_READ_ACL_HEADER,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    const command = new PutObjectCommand({
      ACL: acl,
      Bucket: this.bucket,
      ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      Key: key,
    });

    const url = await getSignedUrl(this.presignClient, command, { expiresIn: 3600 });

    return {
      headers: acl ? { 'x-amz-acl': acl } : undefined,
      url,
    };
  }

  public async createPreSignedUpload(
    key: string,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    return this.createPreSignedUploadWithAcl(
      key,
      this.setAcl ? PUBLIC_READ_ACL_HEADER : undefined,
      contentLength,
    );
  }

  public async createPrivatePreSignedUpload(
    key: string,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    return this.createPreSignedUploadWithAcl(key, undefined, contentLength);
  }

  public async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        ACL: this.setAcl ? PUBLIC_READ_ACL_HEADER : undefined,
        Bucket: this.bucket,
        ContentType: contentType || undefined,
        Key: key,
      }),
    );

    if (!response.UploadId) throw new Error(`S3 did not return an upload id for ${key}`);

    return response.UploadId;
  }

  public async createPreSignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength?: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
    });

    return getSignedUrl(this.presignClient, command, { expiresIn: 3600 });
  }

  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    expectedPartCount: number,
    uploadedParts?: Array<{ ETag: string; PartNumber: number }>,
    expectedFile?: { partSize: number; size: number },
  ) {
    const parts: Array<{ ETag: string; PartNumber: number; Size?: number }> =
      uploadedParts && !expectedFile ? [...uploadedParts] : [];

    if (!uploadedParts || expectedFile) {
      for await (const page of paginateListParts(
        { client: this.client },
        { Bucket: this.bucket, Key: key, UploadId: uploadId },
      )) {
        for (const part of page.Parts ?? []) {
          if (!part.ETag || !part.PartNumber) continue;
          parts.push({ ETag: part.ETag, PartNumber: part.PartNumber, Size: part.Size });
        }
      }
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    const hasAllParts =
      parts.length === expectedPartCount &&
      parts.every((part, index) => part.PartNumber === index + 1);

    if (!hasAllParts) {
      throw new Error(
        `S3 multipart upload ${uploadId} has ${parts.length}/${expectedPartCount} parts`,
      );
    }

    if (expectedFile) {
      const hasExpectedSizes = parts.every((part, index) => {
        const expectedSize =
          index === expectedPartCount - 1
            ? expectedFile.size - expectedFile.partSize * (expectedPartCount - 1)
            : expectedFile.partSize;
        return part.Size === expectedSize;
      });

      if (!hasExpectedSizes) {
        throw new Error(`S3 multipart upload ${uploadId} has an unexpected part size`);
      }
    }

    return this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        MultipartUpload: {
          Parts: parts.map(({ ETag, PartNumber }) => ({ ETag, PartNumber })),
        },
        UploadId: uploadId,
      }),
    );
  }

  public async abortMultipartUpload(key: string, uploadId: string) {
    return this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  public async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.presignClient, command, {
      expiresIn: expiresIn ?? this.previewUrlExpireIn,
    });
  }

  public async createPreSignedUrlForDownload(
    key: string,
    fileName: string,
    expiresIn?: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
    });

    return getSignedUrl(this.presignClient, command, {
      expiresIn: expiresIn ?? this.previewUrlExpireIn,
    });
  }

  /**
   * Upload buffer with specified content type
   */
  public async uploadBuffer(
    path: string,
    buffer: Buffer,
    contentType?: string,
    cacheControl?: string,
  ) {
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: buffer,
      Bucket: this.bucket,
      CacheControl: cacheControl,
      ContentType: contentType,
      Key: path,
    });

    return this.client.send(command);
  }

  public async uploadPrivateBuffer(path: string, buffer: Buffer, contentType?: string) {
    const command = new PutObjectCommand({
      ACL: undefined,
      Body: buffer,
      Bucket: this.bucket,
      ContentType: contentType,
      Key: path,
    });

    return this.client.send(command);
  }

  public async uploadPrivateBufferIfAbsent(path: string, buffer: Buffer, contentType?: string) {
    const command = new PutObjectCommand({
      ACL: undefined,
      Body: buffer,
      Bucket: this.bucket,
      ContentType: contentType,
      IfNoneMatch: '*',
      Key: path,
    });

    return this.client.send(command);
  }

  public async uploadContent(path: string, content: string) {
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: content,
      Bucket: this.bucket,
      Key: path,
    });

    return this.client.send(command);
  }

  /**
   * Upload media file (images only) with long-term cache
   */
  public async uploadMedia(key: string, buffer: Buffer) {
    const contentType = mime.getType(key) || 'application/octet-stream';
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: buffer,
      Bucket: this.bucket,
      CacheControl: `public, max-age=${YEAR}`,
      ContentType: contentType,
      Key: key,
    });

    await this.client.send(command);
  }
}

type FileS3RuntimeCache = {
  cacheKey: string;
  expiresAt: number;
  s3: S3;
};

let fileS3RuntimeCache: FileS3RuntimeCache | null = null;
let fileS3RuntimeCacheGeneration = 0;
const FILE_S3_RUNTIME_CACHE_TTL_MS = 30_000;

const createFileS3RuntimeCacheKey = (config: ServerFileS3Config) =>
  JSON.stringify([
    config.accessKeyId ?? '',
    config.secretAccessKey ?? '',
    config.endpoint ?? '',
    config.internalEndpoint ?? '',
    config.bucket ?? '',
    config.enablePathStyle,
    config.previewUrlExpireIn,
    config.region ?? '',
    config.setAcl,
  ]);

export const invalidateFileS3RuntimeCache = () => {
  fileS3RuntimeCacheGeneration += 1;
  fileS3RuntimeCache = null;
};

export class FileS3 extends S3 {
  private runtimeS3?: S3;

  private readonly staticConfig?: ServerFileS3Config;

  constructor(config?: Partial<ServerFileS3Config>) {
    const envConfig: ServerFileS3Config = {
      accessKeyId: fileEnv.S3_ACCESS_KEY_ID,
      bucket: fileEnv.S3_BUCKET,
      enablePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
      endpoint: fileEnv.S3_ENDPOINT,
      internalEndpoint: fileEnv.S3_INTERNAL_ENDPOINT,
      filePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH || 'files',
      previewUrlExpireIn: fileEnv.S3_PREVIEW_URL_EXPIRE_IN,
      publicDomain: fileEnv.S3_PUBLIC_DOMAIN,
      region: fileEnv.S3_REGION,
      secretAccessKey: fileEnv.S3_SECRET_ACCESS_KEY,
      setAcl: fileEnv.S3_SET_ACL,
    };
    const initialConfig = { ...envConfig, ...config };

    super(
      initialConfig.accessKeyId || '__pending_access_key__',
      initialConfig.secretAccessKey || '__pending_secret_key__',
      initialConfig.endpoint || 'http://localhost',
      {
        bucket: initialConfig.bucket || '__pending_bucket__',
        forcePathStyle: initialConfig.enablePathStyle,
        internalEndpoint: initialConfig.internalEndpoint,
        previewUrlExpireIn: initialConfig.previewUrlExpireIn,
        region: initialConfig.region,
        setAcl: initialConfig.setAcl,
      },
    );

    this.staticConfig = config ? initialConfig : undefined;
  }

  public async getConfig(): Promise<ServerFileS3Config> {
    return this.staticConfig ?? getServerFileS3Config();
  }

  private createS3FromConfig(config: ServerFileS3Config) {
    return new S3(config.accessKeyId, config.secretAccessKey, config.endpoint, {
      bucket: config.bucket,
      forcePathStyle: config.enablePathStyle,
      internalEndpoint: config.internalEndpoint,
      previewUrlExpireIn: config.previewUrlExpireIn,
      region: config.region,
      setAcl: config.setAcl,
    });
  }

  private async getRuntimeS3() {
    if (this.staticConfig) {
      this.runtimeS3 ??= this.createS3FromConfig(this.staticConfig);
      return this.runtimeS3;
    }

    const now = Date.now();
    if (fileS3RuntimeCache && fileS3RuntimeCache.expiresAt > now) {
      return fileS3RuntimeCache.s3;
    }

    const generation = fileS3RuntimeCacheGeneration;
    const config = await this.getConfig();
    const cacheKey = createFileS3RuntimeCacheKey(config);

    if (fileS3RuntimeCache?.cacheKey === cacheKey && fileS3RuntimeCache.expiresAt > now) {
      return fileS3RuntimeCache.s3;
    }

    const s3 = this.createS3FromConfig(config);
    if (generation === fileS3RuntimeCacheGeneration) {
      fileS3RuntimeCache = { cacheKey, expiresAt: now + FILE_S3_RUNTIME_CACHE_TTL_MS, s3 };
    }

    return s3;
  }

  public async deleteFile(key: string) {
    return (await this.getRuntimeS3()).deleteFile(key);
  }

  public async deleteFiles(keys: string[]) {
    return (await this.getRuntimeS3()).deleteFiles(keys);
  }

  public async getFileContent(key: string, byteLength?: number): Promise<string> {
    return (await this.getRuntimeS3()).getFileContent(key, byteLength);
  }

  public async getFileByteArray(key: string): Promise<Uint8Array> {
    return (await this.getRuntimeS3()).getFileByteArray(key);
  }

  public async getFileMetadata(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }> {
    return (await this.getRuntimeS3()).getFileMetadata(key);
  }

  public async createPreSignedUrl(key: string, contentLength?: number): Promise<string> {
    return (await this.getRuntimeS3()).createPreSignedUrl(key, contentLength);
  }

  public async createPreSignedUpload(
    key: string,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    return (await this.getRuntimeS3()).createPreSignedUpload(key, contentLength);
  }

  public async createPrivatePreSignedUpload(
    key: string,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    return (await this.getRuntimeS3()).createPrivatePreSignedUpload(key, contentLength);
  }

  public async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    return (await this.getRuntimeS3()).createMultipartUpload(key, contentType);
  }

  public async createPreSignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength?: number,
  ): Promise<string> {
    return (await this.getRuntimeS3()).createPreSignedUploadPartUrl(
      key,
      uploadId,
      partNumber,
      contentLength,
    );
  }

  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    expectedPartCount: number,
    uploadedParts?: Array<{ ETag: string; PartNumber: number }>,
    expectedFile?: { partSize: number; size: number },
  ) {
    return (await this.getRuntimeS3()).completeMultipartUpload(
      key,
      uploadId,
      expectedPartCount,
      uploadedParts,
      expectedFile,
    );
  }

  public async abortMultipartUpload(key: string, uploadId: string) {
    return (await this.getRuntimeS3()).abortMultipartUpload(key, uploadId);
  }

  public async testConnection() {
    return (await this.getRuntimeS3()).testConnection();
  }

  public async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return (await this.getRuntimeS3()).createPreSignedUrlForPreview(key, expiresIn);
  }

  public async createPreSignedUrlForDownload(
    key: string,
    fileName: string,
    expiresIn?: number,
  ): Promise<string> {
    return (await this.getRuntimeS3()).createPreSignedUrlForDownload(key, fileName, expiresIn);
  }

  public async uploadBuffer(
    path: string,
    buffer: Buffer,
    contentType?: string,
    cacheControl?: string,
  ) {
    return (await this.getRuntimeS3()).uploadBuffer(path, buffer, contentType, cacheControl);
  }

  public async uploadPrivateBuffer(path: string, buffer: Buffer, contentType?: string) {
    return (await this.getRuntimeS3()).uploadPrivateBuffer(path, buffer, contentType);
  }

  public async uploadPrivateBufferIfAbsent(path: string, buffer: Buffer, contentType?: string) {
    return (await this.getRuntimeS3()).uploadPrivateBufferIfAbsent(path, buffer, contentType);
  }

  public async uploadContent(path: string, content: string) {
    return (await this.getRuntimeS3()).uploadContent(path, content);
  }

  public async uploadMedia(key: string, buffer: Buffer) {
    return (await this.getRuntimeS3()).uploadMedia(key, buffer);
  }
}

export class EnvFileS3 extends S3 {
  constructor() {
    super(fileEnv.S3_ACCESS_KEY_ID, fileEnv.S3_SECRET_ACCESS_KEY, fileEnv.S3_ENDPOINT, {
      bucket: fileEnv.S3_BUCKET,
      forcePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
      internalEndpoint: fileEnv.S3_INTERNAL_ENDPOINT,
      previewUrlExpireIn: fileEnv.S3_PREVIEW_URL_EXPIRE_IN,
      region: fileEnv.S3_REGION,
      setAcl: fileEnv.S3_SET_ACL,
    });
  }
}
