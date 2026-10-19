import { describe, expect, it } from 'vitest';

import {
  buildProviderInstancePayload,
  getDefaultBaseUrlForAdminProviderType,
  resolveProviderPricingPolicyForForm,
} from './adminProviderInstanceForm';

describe('buildProviderInstancePayload', () => {
  it('should serialize provider group fields for create payloads', () => {
    expect(
      buildProviderInstancePayload({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com',
        description: '',
        enabled: true,
        fetchOnClient: false,
        groupKey: ' pro ',
        groupMultiplier: 1.25,
        groupName: 'Pro Group',
        name: 'Gateway Pro',
        priority: 10,
        providerType: 'newapi',
        usageScope: ['chat', 'image'],
      }),
    ).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://newapi.example.com',
      enabled: true,
      fetchOnClient: false,
      groupKey: 'pro',
      groupMultiplier: 1.25,
      groupName: 'Pro Group',
      name: 'Gateway Pro',
      priority: 10,
      providerType: 'newapi',
      usageScope: ['chat', 'image'],
    });
  });

  it('should omit masked api keys for update payloads', () => {
    expect(
      buildProviderInstancePayload(
        {
          apiKey: 'sk-****test',
          baseUrl: 'https://newapi.example.com',
          description: 'primary',
          enabled: false,
          fetchOnClient: true,
          groupKey: '',
          groupMultiplier: undefined,
          groupName: '',
          name: 'Default Gateway',
          priority: undefined,
          providerType: 'deepseek',
          usageScope: [],
        },
        { isEdit: true },
      ),
    ).toEqual({
      baseUrl: 'https://newapi.example.com',
      description: 'primary',
      enabled: false,
      fetchOnClient: false,
      groupKey: 'default',
      name: 'Default Gateway',
      priority: 0,
      providerType: 'deepseek',
      usageScope: [],
    });
  });

  it('should omit empty group multiplier from update payloads', () => {
    expect(
      buildProviderInstancePayload(
        {
          apiKey: 'sk-****test',
          baseUrl: 'https://newapi.example.com',
          enabled: true,
          groupKey: 'default',
          groupMultiplier: null as any,
          name: 'Default Gateway',
        },
        { isEdit: true },
      ),
    ).toEqual({
      baseUrl: 'https://newapi.example.com',
      enabled: true,
      fetchOnClient: false,
      groupKey: 'default',
      name: 'Default Gateway',
      priority: 0,
      providerType: 'newapi',
      usageScope: [],
    });
  });

  it('should default provider type to newapi for legacy form values', () => {
    expect(
      buildProviderInstancePayload({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com',
        enabled: true,
        name: 'Legacy Instance',
      }),
    ).toEqual(
      expect.objectContaining({
        providerType: 'newapi',
      }),
    );
  });

  it('should serialize all configurable pricing sources', () => {
    expect(
      buildProviderInstancePayload({
        apiKey: 'sk-test',
        baseUrl: 'https://sub2api.example.com/v1',
        name: 'Sub2API',
        pricingPolicy: {
          lobeHubOfficialPricingEnabled: true,
          modelBankFallbackEnabled: true,
          upstreamSyncEnabled: true,
        },
        providerType: 'sub2api',
      }),
    ).toEqual(
      expect.objectContaining({
        pricingPolicy: {
          lobeHubOfficialPricingEnabled: true,
          modelBankFallbackEnabled: true,
          upstreamSyncEnabled: true,
        },
        providerType: 'sub2api',
      }),
    );
  });

  it('keeps legacy gateways fail-closed until model-bank fallback is explicitly enabled', () => {
    expect(resolveProviderPricingPolicyForForm({ providerType: 'newapi' })).toEqual({
      lobeHubOfficialPricingEnabled: false,
      modelBankFallbackEnabled: false,
      upstreamSyncEnabled: true,
    });
    expect(
      resolveProviderPricingPolicyForForm({ newInstance: true, providerType: 'sub2api' }),
    ).toEqual({
      lobeHubOfficialPricingEnabled: false,
      modelBankFallbackEnabled: true,
      upstreamSyncEnabled: true,
    });
    expect(
      resolveProviderPricingPolicyForForm({
        metadata: {
          pricingPolicy: {
            lobeHubOfficialPricingEnabled: true,
            modelBankFallbackEnabled: true,
            upstreamSyncEnabled: false,
          },
        },
        providerType: 'newapi',
      }),
    ).toEqual({
      lobeHubOfficialPricingEnabled: true,
      modelBankFallbackEnabled: true,
      upstreamSyncEnabled: false,
    });
  });

  it('should expose default base urls for provider presets', () => {
    expect(getDefaultBaseUrlForAdminProviderType('openai')).toBe('https://api.openai.com/v1');
    expect(getDefaultBaseUrlForAdminProviderType('claude')).toBe('https://api.anthropic.com');
    expect(getDefaultBaseUrlForAdminProviderType('deepseek')).toBe('https://api.deepseek.com/v1');
    expect(getDefaultBaseUrlForAdminProviderType('aliyun')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    expect(getDefaultBaseUrlForAdminProviderType('opencode-go')).toBe(
      'https://opencode.ai/zen/go/v1',
    );
    expect(getDefaultBaseUrlForAdminProviderType('siliconflow')).toBe(
      'https://api.siliconflow.cn/v1',
    );
    expect(getDefaultBaseUrlForAdminProviderType('openai-compatible')).toBeUndefined();
    expect(getDefaultBaseUrlForAdminProviderType('sub2api')).toBeUndefined();
  });
});
