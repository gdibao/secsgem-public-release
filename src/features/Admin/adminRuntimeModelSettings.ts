import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';

import type { DefaultModelOption } from './adminSettingsForm';

export interface RuntimeModelFormValues {
  memoryEmbeddingModel: string;
  memoryEmbeddingProvider: string;
  memoryGatekeeperModel: string;
  memoryGatekeeperProvider: string;
  memoryLayerExtractorModel: string;
  memoryLayerExtractorProvider: string;
  memoryPersonaWriterModel: string;
  memoryPersonaWriterProvider: string;
  vectorEmbeddingModel: string;
  vectorEmbeddingProvider: string;
  vectorQueryMode: string;
  vectorRerankerModel: string;
  vectorRerankerProvider: string;
}

export type RuntimeSettingUpdate = { key: string; value: unknown };

export interface BuildRuntimeSettingUpdatesParams {
  chatOptions: DefaultModelOption[];
  embeddingOptions: DefaultModelOption[];
  rerankerOptions: DefaultModelOption[];
  values: RuntimeModelFormValues;
}

export const normalizeRuntimeModelFields = (
  modelValue: string | undefined,
  providerValue: string | undefined,
  options: DefaultModelOption[],
) => {
  const model = modelValue?.trim() ?? '';
  const provider = providerValue?.trim() ?? '';

  if (!model) return { model: '', provider: '' };

  const selected =
    options.find((option) => option.value === model) ??
    options.find((option) => option.model === model && (!provider || option.provider === provider));

  return {
    model: selected?.value === model ? selected.model : model,
    provider: provider || selected?.provider || '',
  };
};

const normalizePair = (
  model: string | undefined,
  provider: string | undefined,
  options: DefaultModelOption[],
) => normalizeRuntimeModelFields(model, provider, options);

export const buildRuntimeSettingUpdates = ({
  chatOptions,
  embeddingOptions,
  rerankerOptions,
  values,
}: BuildRuntimeSettingUpdatesParams): RuntimeSettingUpdate[] => {
  const vectorEmbedding = normalizePair(
    values.vectorEmbeddingModel,
    values.vectorEmbeddingProvider,
    embeddingOptions,
  );
  const vectorReranker = normalizePair(
    values.vectorRerankerModel,
    values.vectorRerankerProvider,
    rerankerOptions,
  );
  const gatekeeper = normalizePair(
    values.memoryGatekeeperModel,
    values.memoryGatekeeperProvider,
    chatOptions,
  );
  const layerExtractor = normalizePair(
    values.memoryLayerExtractorModel,
    values.memoryLayerExtractorProvider,
    chatOptions,
  );
  const personaWriter = normalizePair(
    values.memoryPersonaWriterModel,
    values.memoryPersonaWriterProvider,
    chatOptions,
  );
  const memoryEmbedding = normalizePair(
    values.memoryEmbeddingModel,
    values.memoryEmbeddingProvider,
    embeddingOptions,
  );

  return [
    { key: APP_SETTING_KEYS.vectorEmbeddingProvider, value: vectorEmbedding.provider },
    { key: APP_SETTING_KEYS.vectorEmbeddingModel, value: vectorEmbedding.model },
    { key: APP_SETTING_KEYS.vectorRerankerProvider, value: vectorReranker.provider },
    { key: APP_SETTING_KEYS.vectorRerankerModel, value: vectorReranker.model },
    { key: APP_SETTING_KEYS.vectorQueryMode, value: values.vectorQueryMode?.trim() ?? '' },
    { key: APP_SETTING_KEYS.memoryUserMemoryGatekeeperProvider, value: gatekeeper.provider },
    { key: APP_SETTING_KEYS.memoryUserMemoryGatekeeperModel, value: gatekeeper.model },
    {
      key: APP_SETTING_KEYS.memoryUserMemoryLayerExtractorProvider,
      value: layerExtractor.provider,
    },
    { key: APP_SETTING_KEYS.memoryUserMemoryLayerExtractorModel, value: layerExtractor.model },
    {
      key: APP_SETTING_KEYS.memoryUserMemoryPersonaWriterProvider,
      value: personaWriter.provider,
    },
    { key: APP_SETTING_KEYS.memoryUserMemoryPersonaWriterModel, value: personaWriter.model },
    { key: APP_SETTING_KEYS.memoryUserMemoryEmbeddingProvider, value: memoryEmbedding.provider },
    { key: APP_SETTING_KEYS.memoryUserMemoryEmbeddingModel, value: memoryEmbedding.model },
  ];
};
