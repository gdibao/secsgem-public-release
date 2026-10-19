import { ModelProvider } from 'model-bank';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

type EnabledChatModel = EnabledProviderWithModels['children'][number];

export interface EnabledChatModelMatch {
  model: EnabledChatModel;
  provider: string;
}

export const resolveEnabledChatModel = (
  enabledProviders: EnabledProviderWithModels[],
  model: string,
  provider: string,
): EnabledChatModelMatch | undefined => {
  const directProvider = enabledProviders.find((item) => item.id === provider);
  const directModel = directProvider?.children.find((item) => item.id === model);

  if (directModel) return { model: directModel, provider };

  // `newapi` is the stable business-facing alias. Managed gateway instances can
  // expose concrete provider IDs at runtime, so resolve the alias only when the
  // model has one unambiguous enabled destination.
  if (provider !== ModelProvider.NewAPI) return;

  const candidates = enabledProviders.flatMap((item) => {
    const matchedModel = item.children.find((child) => child.id === model);
    return matchedModel ? [{ model: matchedModel, provider: item.id }] : [];
  });

  return candidates.length === 1 ? candidates[0] : undefined;
};
