import { moduleAppWorkflowDefinitionSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createModuleAppFunctionWorkflowExecutor } from './function';

const node = moduleAppWorkflowDefinitionSchema.parse({
  edges: [],
  key: 'function_workflow',
  nodes: [{ config: { functionKey: 'load_candidate' }, key: 'load', type: 'function' }],
  startNodeKey: 'load',
  version: 1,
}).nodes[0];

describe('createModuleAppFunctionWorkflowExecutor', () => {
  it('uses only a fixed reviewed registry and forwards the idempotency key', async () => {
    const assertEntitlement = vi.fn().mockResolvedValue(undefined);
    const loadCandidate = vi.fn().mockResolvedValue({ candidate: { id: 'candidate-1' } });
    const execute = createModuleAppFunctionWorkflowExecutor({
      assertEntitlement,
      registry: { load_candidate: loadCandidate },
    });

    await expect(
      execute({
        idempotencyKey: 'run-1:load:1',
        input: { candidateId: 'candidate-1' },
        node,
        runId: 'run-1',
      }),
    ).resolves.toEqual({ output: { candidate: { id: 'candidate-1' } } });
    expect(assertEntitlement).toHaveBeenCalledOnce();
    expect(loadCandidate).toHaveBeenCalledWith({
      idempotencyKey: 'run-1:load:1',
      input: { candidateId: 'candidate-1' },
      node,
      runId: 'run-1',
    });
  });

  it('rejects keys outside the fixed registry with a stable code', async () => {
    const execute = createModuleAppFunctionWorkflowExecutor({
      assertEntitlement: vi.fn(),
      registry: {},
    });

    await expect(
      execute({ idempotencyKey: 'key', input: {}, node, runId: 'run-1' }),
    ).rejects.toThrow('MODULE_APP_WORKFLOW_FUNCTION_NOT_REGISTERED');
  });
});
