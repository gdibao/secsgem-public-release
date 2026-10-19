import { describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';

import {
  buildRuntimeSettingUpdates,
  normalizeRuntimeModelFields,
} from './adminRuntimeModelSettings';
import type { DefaultModelOption } from './adminSettingsForm';

const chatOptions: DefaultModelOption[] = [
  {
    label: 'DeepSeek V4 Pro (opencode-go / OpenCode Go / chat)',
    model: 'deepseek-v4-pro',
    provider: 'provider-1',
    providerLabel: 'opencode-go / OpenCode Go',
    value: 'provider-1:deepseek-v4-pro',
  },
];

const embeddingOptions: DefaultModelOption[] = [
  {
    label: 'Embedding (OpenCode Go / embedding)',
    model: 'embedding-model',
    provider: 'embedding-provider',
    value: 'embedding-provider:embedding-model',
  },
];

describe('normalizeRuntimeModelFields', () => {
  it('converts a catalog selection into raw model and provider identifiers', () => {
    expect(normalizeRuntimeModelFields('provider-1:deepseek-v4-pro', '', chatOptions)).toEqual({
      model: 'deepseek-v4-pro',
      provider: 'provider-1',
    });
  });

  it('clears a stale provider when the model is cleared', () => {
    expect(normalizeRuntimeModelFields('', 'stale-provider', chatOptions)).toEqual({
      model: '',
      provider: '',
    });
  });

  it('preserves a saved pair that is outside the current catalog', () => {
    expect(normalizeRuntimeModelFields('legacy-model', 'legacy-provider', chatOptions)).toEqual({
      model: 'legacy-model',
      provider: 'legacy-provider',
    });
  });
});

describe('buildRuntimeSettingUpdates', () => {
  it('serializes every runtime pair with raw identifiers and clears stale providers', () => {
    expect(
      buildRuntimeSettingUpdates({
        chatOptions,
        embeddingOptions,
        rerankerOptions: chatOptions,
        values: {
          memoryEmbeddingModel: 'embedding-model',
          memoryEmbeddingProvider: 'embedding-provider',
          memoryGatekeeperModel: 'deepseek-v4-pro',
          memoryGatekeeperProvider: 'provider-1',
          memoryLayerExtractorModel: 'legacy-layer-model',
          memoryLayerExtractorProvider: 'legacy-provider',
          memoryPersonaWriterModel: 'provider-1:deepseek-v4-pro',
          memoryPersonaWriterProvider: '',
          vectorEmbeddingModel: 'embedding-provider:embedding-model',
          vectorEmbeddingProvider: '',
          vectorQueryMode: 'hybrid',
          vectorRerankerModel: '',
          vectorRerankerProvider: 'stale-provider',
        },
      }),
    ).toEqual([
      { key: APP_SETTING_KEYS.vectorEmbeddingProvider, value: 'embedding-provider' },
      { key: APP_SETTING_KEYS.vectorEmbeddingModel, value: 'embedding-model' },
      { key: APP_SETTING_KEYS.vectorRerankerProvider, value: '' },
      { key: APP_SETTING_KEYS.vectorRerankerModel, value: '' },
      { key: APP_SETTING_KEYS.vectorQueryMode, value: 'hybrid' },
      { key: APP_SETTING_KEYS.memoryUserMemoryGatekeeperProvider, value: 'provider-1' },
      { key: APP_SETTING_KEYS.memoryUserMemoryGatekeeperModel, value: 'deepseek-v4-pro' },
      {
        key: APP_SETTING_KEYS.memoryUserMemoryLayerExtractorProvider,
        value: 'legacy-provider',
      },
      {
        key: APP_SETTING_KEYS.memoryUserMemoryLayerExtractorModel,
        value: 'legacy-layer-model',
      },
      { key: APP_SETTING_KEYS.memoryUserMemoryPersonaWriterProvider, value: 'provider-1' },
      { key: APP_SETTING_KEYS.memoryUserMemoryPersonaWriterModel, value: 'deepseek-v4-pro' },
      {
        key: APP_SETTING_KEYS.memoryUserMemoryEmbeddingProvider,
        value: 'embedding-provider',
      },
      { key: APP_SETTING_KEYS.memoryUserMemoryEmbeddingModel, value: 'embedding-model' },
    ]);
  });
});
