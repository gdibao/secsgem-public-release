import { moduleAppWorkflowDefinitionSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createModuleAppAiWorkflowExecutor } from './ai';

const node = moduleAppWorkflowDefinitionSchema.parse({
  edges: [],
  key: 'ai_workflow',
  nodes: [
    {
      config: { model: 'gpt-test', promptTemplate: 'Review {{candidateId}}', provider: 'openai' },
      key: 'review',
      type: 'ai',
    },
  ],
  startNodeKey: 'review',
  version: 1,
}).nodes[0];

describe('createModuleAppAiWorkflowExecutor', () => {
  it('rechecks entitlement and persists idempotent AI usage output', async () => {
    const assertEntitlement = vi.fn().mockResolvedValue(undefined);
    const textGenerator = vi.fn().mockResolvedValue({
      actualAiCredits: 2.5,
      text: 'Approved',
      tokenUsage: { input: 10, output: 2, total: 12 },
    });
    const execute = createModuleAppAiWorkflowExecutor({
      appMultiplier: 2,
      assertEntitlement,
      chargeAiUsage: true,
      textGenerator,
      userId: 'user-1',
    });

    await expect(
      execute({
        idempotencyKey: 'run-1:review:1',
        input: { candidateId: 'candidate-1' },
        node,
        runId: 'run-1',
      }),
    ).resolves.toEqual({
      output: {
        model: 'gpt-test',
        provider: 'openai',
        text: 'Approved',
        tokenUsage: { input: 10, output: 2, total: 12 },
      },
      usage: { actualAiCredits: 2.5, tokenUsage: { input: 10, output: 2, total: 12 } },
    });
    expect(assertEntitlement).toHaveBeenCalledOnce();
    expect(textGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        chargeAiUsage: true,
        idempotencyKey: 'run-1:review:1',
        prompt: 'Review candidate-1',
        userId: 'user-1',
      }),
    );
  });

  it('uses a stable failure code for incomplete reviewed AI config', async () => {
    const invalidNode = { ...node, config: {} };
    const execute = createModuleAppAiWorkflowExecutor({
      appMultiplier: 1,
      assertEntitlement: vi.fn(),
      chargeAiUsage: false,
      textGenerator: vi.fn(),
      userId: 'user-1',
    });

    await expect(
      execute({ idempotencyKey: 'key', input: {}, node: invalidNode, runId: 'run-1' }),
    ).rejects.toThrow('MODULE_APP_WORKFLOW_AI_NOT_CONFIGURED');
  });
});
