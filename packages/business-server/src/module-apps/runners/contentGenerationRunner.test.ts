import type { ModuleAppActionConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { runModuleAppContentGeneration } from './contentGenerationRunner';

const action: ModuleAppActionConfig = {
  id: 'generate',
  inputSchema: { fields: [] },
  moduleMultiplier: 1,
  name: 'Generate',
  outputSchema: {},
  runtimeConfig: {
    artifactNameTemplate: '{{topic}} report?.md',
    artifactMimeType: 'text/markdown',
    model: 'gpt-test',
    promptTemplate: 'Write about {{topic}}',
    provider: 'openai',
  },
  runtimeType: 'content_generation',
};

describe('runModuleAppContentGeneration', () => {
  it('renders prompt and returns a markdown artifact request', async () => {
    const textGenerator = vi.fn().mockResolvedValue({
      actualAiCredits: 12,
      text: 'Apple report',
      tokenUsage: { completion: 20, prompt: 10 },
    });

    const result = await runModuleAppContentGeneration({
      action,
      appMultiplier: 1.5,
      chargeAiUsage: true,
      idempotencyKey: 'run-1:generate',
      input: { topic: 'apple' },
      textGenerator,
      userId: 'user-1',
    });

    expect(textGenerator).toHaveBeenCalledWith({
      actionMultiplier: 1,
      appMultiplier: 1.5,
      chargeAiUsage: true,
      model: 'gpt-test',
      idempotencyKey: 'run-1:generate',
      prompt: 'Write about apple',
      provider: 'newapi',
      userId: 'user-1',
    });
    expect(result).toMatchObject({
      actualAiCredits: 12,
      artifacts: [
        {
          content: 'Apple report',
          fileName: 'apple-report.md',
          mimeType: 'text/markdown',
        },
      ],
      output: {
        model: 'gpt-test',
        provider: 'newapi',
        text: 'Apple report',
        tokenUsage: { completion: 20, prompt: 10 },
      },
      preview: 'Apple report',
    });
  });

  it('requires an injected text generator', async () => {
    await expect(
      runModuleAppContentGeneration({
        action,
        appMultiplier: 1,
        chargeAiUsage: false,
        idempotencyKey: 'run-2:generate',
        input: { topic: 'apple' },
        userId: 'user-1',
      }),
    ).rejects.toThrow('MODULE_APP_TEXT_GENERATOR_REQUIRED');
  });
});
