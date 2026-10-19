import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ModuleAppObjectStorage } from '@lobechat/module-app-build';

import type { ModuleAppWorkerConfig } from './config';
import { ModuleAppWorkerError } from './errors';

const toUint8Array = (value: unknown) => {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('MODULE_APP_BUILD_S3_BODY_INVALID');
};

const readBoundedBody = async (
  body: unknown,
  maxBytes: number,
  contentLength?: number,
) => {
  if (!body || typeof body !== 'object' || !(Symbol.asyncIterator in body)) {
    throw new Error('MODULE_APP_BUILD_S3_BODY_INVALID');
  }

  const capacity = contentLength ?? maxBytes;
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > maxBytes) {
    throw new Error('MODULE_APP_BUILD_S3_BODY_TOO_LARGE');
  }
  const bytes = new Uint8Array(capacity);
  let total = 0;
  for await (const value of body as AsyncIterable<unknown>) {
    const chunk = toUint8Array(value);
    if (total + chunk.byteLength > capacity) {
      throw new Error('MODULE_APP_BUILD_S3_BODY_TOO_LARGE');
    }
    bytes.set(chunk, total);
    total += chunk.byteLength;
  }
  return bytes.subarray(0, total);
};

export const createModuleAppWorkerStorage = (
  config: ModuleAppWorkerConfig,
): ModuleAppObjectStorage => {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3EnablePathStyle,
    region: config.s3Region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const commandInput = (key: string) => ({ Bucket: config.s3Bucket, Key: key });

  return {
    deleteObject: async ({ key }) => {
      try {
        await client.send(new DeleteObjectCommand(commandInput(key)));
      } catch (error) {
        throw new ModuleAppWorkerError(
          'MODULE_APP_BUILD_S3_WRITE_FAILED',
          'retryable',
          error,
        );
      }
    },
    getObject: async ({ key }) => {
      try {
        const response = await client.send(
          new GetObjectCommand(commandInput(key)),
        );
        if (
          response.ContentLength !== undefined &&
          response.ContentLength > config.artifactMaxBytes
        ) {
          throw new Error('MODULE_APP_BUILD_S3_BODY_TOO_LARGE');
        }
        return await readBoundedBody(
          response.Body,
          config.artifactMaxBytes,
          response.ContentLength,
        );
      } catch (error) {
        throw new ModuleAppWorkerError(
          'MODULE_APP_BUILD_S3_READ_FAILED',
          'retryable',
          error,
        );
      }
    },
    headObject: async ({ key }) => {
      try {
        const response = await client.send(
          new HeadObjectCommand(commandInput(key)),
        );
        return { contentLength: response.ContentLength ?? 0 };
      } catch (error) {
        throw new ModuleAppWorkerError(
          'MODULE_APP_BUILD_S3_HEAD_FAILED',
          'retryable',
          error,
        );
      }
    },
    putObject: async ({ body, cacheControl, contentType, key }) => {
      if (body.byteLength > config.artifactMaxBytes) {
        throw new ModuleAppWorkerError(
          'MODULE_APP_BUILD_S3_WRITE_FAILED',
          'retryable',
        );
      }
      try {
        await client.send(
          new PutObjectCommand({
            ...commandInput(key),
            Body: body,
            CacheControl: cacheControl,
            ContentLength: body.byteLength,
            ContentType: contentType,
          }),
        );
      } catch (error) {
        throw new ModuleAppWorkerError(
          'MODULE_APP_BUILD_S3_WRITE_FAILED',
          'retryable',
          error,
        );
      }
    },
  };
};
