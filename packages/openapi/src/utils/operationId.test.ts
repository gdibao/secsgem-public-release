// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildOpenApiChatMetadata, resolveOpenApiOperationId } from './operationId';

describe('OpenAPI operation IDs', () => {
  it('prefers the idempotency key over transport request ids', () => {
    expect(
      resolveOpenApiOperationId(
        (name) =>
          ({
            'idempotency-key': ' billing-request-1 ',
            'x-request-id': 'transport-request-1',
          })[name.toLowerCase()],
      ),
    ).toBe('billing-request-1');
  });

  it('falls back to a bounded request id and rejects oversized values', () => {
    expect(
      resolveOpenApiOperationId((name) => ({ 'x-request-id': 'request-2' })[name.toLowerCase()]),
    ).toBe('request-2');
    expect(
      resolveOpenApiOperationId(
        (name) => ({ 'idempotency-key': 'x'.repeat(241) })[name.toLowerCase()],
      ),
    ).toBeUndefined();
  });

  it('builds retry-safe billing metadata and generates a fallback id', () => {
    expect(buildOpenApiChatMetadata('billing-request-1')).toEqual({
      operationId: 'billing-request-1',
      trigger: RequestTrigger.Api,
    });
    expect(buildOpenApiChatMetadata()).toEqual({
      operationId: expect.any(String),
      trigger: RequestTrigger.Api,
    });
  });
});
