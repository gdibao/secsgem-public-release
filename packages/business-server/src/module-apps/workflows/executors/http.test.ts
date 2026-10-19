import { moduleAppWorkflowDefinitionSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createModuleAppHttpWorkflowExecutor } from './http';

const node = moduleAppWorkflowDefinitionSchema.parse({
  edges: [],
  key: 'http_workflow',
  nodes: [
    {
      config: {
        body: { candidateId: '{{candidateId}}' },
        headers: { 'x-request-id': '{{candidateId}}' },
        method: 'POST',
        url: 'https://reviewed.example.com/check',
      },
      key: 'request',
      type: 'http',
    },
  ],
  startNodeKey: 'request',
  version: 1,
}).nodes[0];

describe('createModuleAppHttpWorkflowExecutor', () => {
  it('rechecks entitlement and delegates only through the reviewed-host gateway', async () => {
    const assertEntitlement = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({
      body: JSON.stringify({ accepted: true }),
      contentType: 'application/json',
      status: 200,
    });
    const execute = createModuleAppHttpWorkflowExecutor({ assertEntitlement, request });

    await expect(
      execute({
        idempotencyKey: 'run-1:request:1',
        input: { candidateId: 'candidate-1' },
        node,
        runId: 'run-1',
      }),
    ).resolves.toEqual({
      output: {
        body: { accepted: true },
        contentType: 'application/json',
        status: 200,
      },
    });
    expect(assertEntitlement).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      body: JSON.stringify({ candidateId: 'candidate-1' }),
      headers: { 'x-request-id': 'candidate-1' },
      method: 'POST',
      url: 'https://reviewed.example.com/check',
    });
  });

  it('rejects an unconfigured HTTP node with a stable code', async () => {
    const execute = createModuleAppHttpWorkflowExecutor({
      assertEntitlement: vi.fn(),
      request: vi.fn(),
    });

    await expect(
      execute({
        idempotencyKey: 'key',
        input: {},
        node: { ...node, config: {} },
        runId: 'run-1',
      }),
    ).rejects.toThrow('MODULE_APP_WORKFLOW_HTTP_NOT_CONFIGURED');
  });
});
