import { describe, expect, it } from 'vitest';

import {
  buildModelCatalog,
  buildModelCatalogViews,
  getModelCatalogDuplicateModelGroups,
  getModelCatalogHealth,
  resolveModelCatalogModelDisplayName,
  resolveModelCatalogProviderDisplayName,
  resolveVisibleAiProviderRuntimeState,
} from './visibleModels';

const createState = () =>
  ({
    enabledAiModels: [
      { enabled: true, groupKey: 'free', id: 'free-chat', providerId: 'newapi', type: 'chat' },
      { enabled: true, groupKey: 'pro', id: 'pro-chat', providerId: 'newapi', type: 'chat' },
      { enabled: true, groupKey: 'pro', id: 'pro-image', providerId: 'newapi', type: 'image' },
    ],
    enabledAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    enabledChatAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    enabledImageAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    enabledVideoAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    runtimeConfig: {},
  }) as any;

describe('visible model catalog', () => {
  it('explains models hidden by plan rules', () => {
    const catalog = buildModelCatalog({
      planRules: {
        chat: {
          allowlist: ['free:*'],
          mode: 'allowlist',
        },
      } as any,
      state: createState(),
    });

    expect(catalog.find((entry) => entry.model.id === 'free-chat')?.visible).toBe(true);
    expect(catalog.find((entry) => entry.model.id === 'pro-chat')?.visibilityReason).toMatchObject({
      code: 'disabled_by_plan_rule',
    });
  });

  it('returns a runtime state with providers recalculated from visible models', () => {
    const state = resolveVisibleAiProviderRuntimeState({
      planRules: {
        image: {
          allowlist: ['no-image'],
          mode: 'allowlist',
        },
      } as any,
      state: createState(),
    });

    expect(state.enabledAiModels.map((model) => model.id)).toEqual(['free-chat', 'pro-chat']);
    expect(state.enabledImageAiProviders).toEqual([]);
    expect(state.enabledChatAiProviders).toEqual([{ id: 'newapi', name: 'AI Provider' }]);
  });

  it('summarizes catalog health', () => {
    const catalog = buildModelCatalog({
      planRules: {
        chat: {
          allowlist: ['free:*'],
          mode: 'allowlist',
        },
      } as any,
      state: createState(),
    });

    expect(getModelCatalogHealth(catalog)).toMatchObject({
      hiddenByPlanCount: 1,
      totalCount: 3,
      visibleCount: 2,
    });
  });

  it('resolves readable provider and model display names without exposing UUID providers', () => {
    const catalog = buildModelCatalog({
      state: {
        ...createState(),
        enabledAiModels: [
          {
            displayName: 'DeepSeek V4 Pro',
            enabled: true,
            id: 'deepseek-v4-pro',
            instanceName: 'ToAPI',
            providerId: '757e1732-8478-4c93-a4dd-1e17489a9c48',
            type: 'chat',
          },
          {
            enabled: true,
            id: 'deepseek-chat',
            providerId: '757e1732-8478-4c93-a4dd-1e17489a9c48',
            type: 'chat',
          },
        ],
      } as any,
    });

    expect(resolveModelCatalogProviderDisplayName(catalog[0])).toBe('ToAPI');
    expect(resolveModelCatalogModelDisplayName(catalog[0])).toBe('DeepSeek V4 Pro');
    expect(resolveModelCatalogProviderDisplayName(catalog[1])).toBe('Custom provider');
    expect(resolveModelCatalogModelDisplayName(catalog[1])).toBe('deepseek-chat');
  });

  it('groups duplicate model IDs across provider instances by type and model ID', () => {
    const catalog = buildModelCatalog({
      state: {
        ...createState(),
        enabledAiModels: [
          {
            enabled: true,
            id: 'deepseek-chat',
            instanceName: 'ToAPI',
            providerId: 'toapi',
            type: 'chat',
          },
          {
            enabled: true,
            id: 'deepseek-chat',
            providerId: 'siliconflow',
            providerType: 'SiliconFlow',
            type: 'chat',
          },
          {
            enabled: true,
            id: 'deepseek-chat',
            providerId: 'image-provider',
            type: 'image',
          },
        ],
      } as any,
    });

    expect(getModelCatalogDuplicateModelGroups(catalog)).toEqual([
      {
        count: 2,
        key: 'chat:deepseek-chat',
        modelId: 'deepseek-chat',
        providers: ['ToAPI', 'SiliconFlow'],
        type: 'chat',
      },
    ]);
  });

  it('normalizes runtime models into a stable provider-aware view', () => {
    const catalog = buildModelCatalog({
      planRules: {
        chat: { allowlist: ['free:*'], mode: 'allowlist' },
      } as any,
      state: {
        ...createState(),
        enabledAiModels: [
          {
            abilities: ['vision'],
            displayName: 'Free Chat',
            enabled: true,
            id: 'free-chat',
            instanceName: 'Managed NewAPI',
            pricing: { currency: 'CNY' },
            providerId: 'newapi',
            source: 'admin-managed',
            type: 'chat',
          },
          {
            enabled: true,
            groupKey: 'pro',
            id: 'pro-chat',
            providerId: 'newapi',
            type: 'chat',
          },
        ],
      } as any,
    });

    expect(buildModelCatalogViews(catalog)).toEqual([
      expect.objectContaining({
        abilities: ['vision'],
        displayName: 'Free Chat',
        enabled: true,
        modelId: 'free-chat',
        pricing: { currency: 'CNY' },
        providerId: 'newapi',
        providerName: 'Managed NewAPI',
        restricted: false,
        source: 'admin-managed',
        type: 'chat',
      }),
      expect.objectContaining({
        displayName: 'pro-chat',
        restricted: true,
      }),
    ]);
  });
});
