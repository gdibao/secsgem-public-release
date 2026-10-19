import type { ModuleAppActionConfig, ModuleAppAiMessage } from '@lobechat/types';

import {
  renderModuleAppTemplateString,
  sanitizeModuleAppArtifactFileName,
} from '../runtimeTemplate';
import type { ModuleAppRunnerResult } from './apiActionRunner';

export type ModuleAppTextGenerator = (input: {
  actionMultiplier: number;
  appMultiplier: number;
  chargeAiUsage: boolean;
  idempotencyKey: string;
  maxTokens?: number;
  messages?: ModuleAppAiMessage[];
  model?: string;
  prompt?: string;
  provider?: string;
  temperature?: number;
  userId: string;
}) => Promise<{
  actualAiCredits: number;
  text: string;
  tokenUsage?: Record<string, number>;
}>;

export interface RunModuleAppContentGenerationInput {
  action: ModuleAppActionConfig;
  appMultiplier: number;
  chargeAiUsage: boolean;
  idempotencyKey: string;
  input: Record<string, unknown>;
  textGenerator?: ModuleAppTextGenerator;
  userId: string;
}

const getStringConfig = (config: Record<string, unknown>, key: string) => {
  const value = config[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const runModuleAppContentGeneration = async ({
  action,
  appMultiplier,
  chargeAiUsage,
  idempotencyKey,
  input,
  textGenerator,
  userId,
}: RunModuleAppContentGenerationInput): Promise<ModuleAppRunnerResult> => {
  const config = action.runtimeConfig;
  const promptTemplate = getStringConfig(config, 'promptTemplate');

  if (action.runtimeType !== 'content_generation' || !promptTemplate) {
    throw new Error('MODULE_APP_CONTENT_GENERATION_NOT_CONFIGURED');
  }

  if (!textGenerator) {
    throw new Error('MODULE_APP_TEXT_GENERATOR_REQUIRED');
  }

  const provider = 'newapi';
  const model = getStringConfig(config, 'model');
  const prompt = renderModuleAppTemplateString(promptTemplate, input);
  const generated = await textGenerator({
    actionMultiplier: action.moduleMultiplier,
    appMultiplier,
    chargeAiUsage,
    idempotencyKey,
    model,
    prompt,
    provider,
    userId,
  });
  const artifactMimeType = getStringConfig(config, 'artifactMimeType') ?? 'text/markdown';
  const artifactName = sanitizeModuleAppArtifactFileName(
    renderModuleAppTemplateString(
      getStringConfig(config, 'artifactNameTemplate') ?? 'module-app-result.md',
      input,
    ),
  );

  return {
    actualAiCredits: generated.actualAiCredits,
    artifacts:
      artifactMimeType === 'text/markdown'
        ? [
            {
              content: generated.text,
              fileName: artifactName,
              mimeType: artifactMimeType,
            },
          ]
        : [],
    output: {
      model,
      provider,
      text: generated.text,
      tokenUsage: generated.tokenUsage ?? {},
    },
    preview: generated.text,
  };
};
