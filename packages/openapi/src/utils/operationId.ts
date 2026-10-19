import { RequestTrigger } from '@lobechat/types';

const MAX_OPERATION_ID_LENGTH = 240;

const normalizeOperationId = (value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized || normalized.length > MAX_OPERATION_ID_LENGTH) return undefined;

  return normalized;
};

export const resolveOpenApiOperationId = (getHeader: (name: string) => string | undefined) =>
  normalizeOperationId(getHeader('Idempotency-Key')) ??
  normalizeOperationId(getHeader('X-Request-ID'));

export const buildOpenApiChatMetadata = (operationId?: string) => ({
  operationId:
    normalizeOperationId(operationId) ??
    globalThis.crypto?.randomUUID?.() ??
    [Date.now(), Math.random().toString(36).slice(2)].join('-'),
  trigger: RequestTrigger.Api,
});
