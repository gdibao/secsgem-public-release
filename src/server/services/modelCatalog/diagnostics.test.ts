import { describe, expect, it } from 'vitest';

import { getModelCatalogDiagnostics } from './diagnostics';

const createState = (models: any[]) =>
  ({
    enabledAiModels: models,
    enabledAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    enabledChatAiProviders: [{ id: 'newapi', name: 'AI Provider' }],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: {},
  }) as any;

describe('model catalog diagnostics', () => {
  it('reports an error when no enabled models exist', () => {
    const diagnostics = getModelCatalogDiagnostics({ state: createState([]) });

    expect(diagnostics.health.totalCount).toBe(0);
    expect(diagnostics.risks).toContainEqual(
      expect.objectContaining({ key: 'no_models', level: 'error' }),
    );
  });

  it('reports hidden models and duplicate model keys', () => {
    const diagnostics = getModelCatalogDiagnostics({
      planRules: {
        chat: {
          allowlist: ['pro:*'],
          mode: 'allowlist',
        },
      } as any,
      state: createState([
        { enabled: true, groupKey: 'free', id: 'shared-chat', providerId: 'newapi', type: 'chat' },
        { enabled: true, groupKey: 'pro', id: 'shared-chat', providerId: 'newapi', type: 'chat' },
      ]),
    });

    expect(diagnostics.health).toMatchObject({
      hiddenByPlanCount: 1,
      totalCount: 2,
      visibleCount: 1,
    });
    expect(diagnostics.hiddenByReason).toEqual({ disabled_by_plan_rule: 1 });
    expect(diagnostics.risks).toContainEqual(
      expect.objectContaining({
        key: 'duplicate:newapi:shared-chat:chat',
        level: 'warning',
      }),
    );
  });

  it('reports duplicate model IDs across different provider instances', () => {
    const diagnostics = getModelCatalogDiagnostics({
      state: createState([
        {
          enabled: true,
          id: 'shared-chat',
          instanceName: 'ToAPI',
          providerId: 'toapi',
          type: 'chat',
        },
        {
          enabled: true,
          id: 'shared-chat',
          providerId: 'siliconflow',
          providerType: 'SiliconFlow',
          type: 'chat',
        },
      ]),
    });

    expect(diagnostics.risks).toContainEqual(
      expect.objectContaining({
        key: 'duplicate:chat:shared-chat',
        level: 'warning',
      }),
    );
    expect(diagnostics.risks.at(-1)?.message).toContain('ToAPI');
    expect(diagnostics.risks.at(-1)?.message).toContain('SiliconFlow');
  });

  it('exposes the stable provider-aware model views for diagnostics consumers', () => {
    const diagnostics = getModelCatalogDiagnostics({
      state: createState([
        {
          displayName: 'Managed Chat',
          enabled: true,
          id: 'managed-chat',
          instanceName: 'NewAPI',
          pricing: { currency: 'CNY' },
          providerId: 'newapi',
          source: 'admin-managed',
          type: 'chat',
        },
      ]),
    });

    expect(diagnostics.views).toEqual([
      expect.objectContaining({
        displayName: 'Managed Chat',
        modelId: 'managed-chat',
        pricing: { currency: 'CNY' },
        providerName: 'NewAPI',
        source: 'admin-managed',
      }),
    ]);
  });
});
