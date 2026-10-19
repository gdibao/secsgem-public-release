import type { ModuleAppTextGenerator } from '../../runners/contentGenerationRunner';
import { renderModuleAppTemplateString } from '../../runtimeTemplate';
import {
  assertModuleAppWorkflowOutput,
  type ModuleAppWorkflowNodeExecutor,
} from '../executors';

const stringConfig = (config: Record<string, unknown>, key: string) => {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const createModuleAppAiWorkflowExecutor = (options: {
  appMultiplier: number;
  assertEntitlement: () => Promise<unknown> | unknown;
  chargeAiUsage: boolean;
  textGenerator: ModuleAppTextGenerator;
  userId: string;
}): ModuleAppWorkflowNodeExecutor => async (context) => {
  const promptTemplate = stringConfig(context.node.config, 'promptTemplate');
  const provider = stringConfig(context.node.config, 'provider');
  const model = stringConfig(context.node.config, 'model');
  if (!promptTemplate || !provider || !model) {
    throw new Error('MODULE_APP_WORKFLOW_AI_NOT_CONFIGURED');
  }

  await options.assertEntitlement();
  const generated = await options.textGenerator({
    actionMultiplier: 1,
    appMultiplier: options.appMultiplier,
    chargeAiUsage: options.chargeAiUsage,
    idempotencyKey: context.idempotencyKey,
    model,
    prompt: renderModuleAppTemplateString(promptTemplate, context.input),
    provider,
    userId: options.userId,
  });
  const tokenUsage = generated.tokenUsage ?? {};
  const output = assertModuleAppWorkflowOutput({
    model,
    provider,
    text: generated.text,
    tokenUsage,
  });

  return {
    output,
    usage: assertModuleAppWorkflowOutput({
      actualAiCredits: generated.actualAiCredits,
      tokenUsage,
    }),
  };
};
