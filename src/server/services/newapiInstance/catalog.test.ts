import type { Pricing } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildNewapiPricingSyncWarnings,
  classifyNewapiModelType,
  fetchNewapiModels,
  fetchNewapiPricing,
  normalizeNewapiSyncRows,
} from './catalog';

vi.mock('model-bank', async (importOriginal) => ({
  ...(await importOriginal()),
  LOBE_DEFAULT_MODEL_LIST: [
    {
      abilities: { functionCall: true, reasoning: true },
      id: 'system-capability-model',
      providerId: 'openai',
      type: 'chat',
    },
  ],
}));

describe('NewAPI catalog sync', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('classifies models from supported endpoint metadata first', () => {
    expect(
      classifyNewapiModelType({
        id: 'custom-model',
        supported_endpoint_types: ['chat', 'image_generation'],
      }),
    ).toBe('image');

    expect(
      classifyNewapiModelType({
        id: 'custom-model',
        supported_endpoint_types: ['videos'],
      }),
    ).toBe('video');
  });

  it('classifies models from model id when endpoint metadata is missing', () => {
    expect(classifyNewapiModelType({ id: 'flux-pro-1.1' })).toBe('image');
    expect(classifyNewapiModelType({ id: 'sora-2' })).toBe('video');
    expect(classifyNewapiModelType({ id: 'text-embedding-3-large' })).toBe('embedding');
    expect(classifyNewapiModelType({ id: 'Qwen/Qwen3-Reranker-8B' })).toBe('embedding');
    expect(classifyNewapiModelType({ id: 'gpt-4o-mini' })).toBe('chat');
  });

  it('classifies speech, realtime, and music models from explicit types and endpoints', () => {
    expect(classifyNewapiModelType({ id: 'custom', type: 'tts' })).toBe('tts');
    expect(
      classifyNewapiModelType({ id: 'custom', supported_endpoint_types: ['audio_transcription'] }),
    ).toBe('asr');
    expect(classifyNewapiModelType({ id: 'FunAudioLLM/SenseVoiceSmall', type: 'tts' })).toBe('asr');
    expect(classifyNewapiModelType({ id: 'TeleAI/TeleSpeechASR', type: 'tts' })).toBe('asr');
    expect(classifyNewapiModelType({ id: 'gpt-4o-realtime-preview' })).toBe('realtime');
    expect(classifyNewapiModelType({ id: 'suno-v4' })).toBe('text2music');
  });

  it('normalizes synchronized rows as disabled by default', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o-mini', object: 'model' }],
      pricing: [],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        enabled: false,
        modelId: 'gpt-4o-mini',
        modelType: 'chat',
      }),
    ]);
  });

  it('always rebuilds synchronized rows as disabled', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'sora-2', object: 'model' }],
      pricing: [],
    });

    expect(rows[0]).toEqual(expect.objectContaining({ enabled: false, modelType: 'video' }));
  });

  it('builds rows only from the latest upstream payload', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o', object: 'model' }],
      pricing: [{ description: 'Remote Name', model_name: 'gpt-4o', model_ratio: 15 }],
      pricingStatus: 'available',
    });

    expect(rows[0]).toMatchObject({
      displayName: 'Remote Name',
      enabled: false,
      metadata: {
        modelRatio: 15,
      },
      sortOrder: 0,
    });
    expect(rows[0].metadata).not.toHaveProperty('customField');
    expect(rows[0].metadata).not.toHaveProperty('manualAbilities');
    expect(rows[0].metadata).not.toHaveProperty('manualPricing');
  });

  it('does not invent pricing when pricing transport is unavailable', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o', object: 'model' }],
      pricing: [],
      pricingStatus: 'unavailable',
    });

    expect(rows[0].metadata).toMatchObject({ pricingSyncStatus: 'unavailable' });
    expect(rows[0].metadata).not.toHaveProperty('modelRatio');
    expect(rows[0].metadata).not.toHaveProperty('pricingAvailable', true);
  });

  it('does not retain manual or unsafe synchronized pricing', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o', object: 'model' }],
      pricing: [],
      pricingStatus: 'unsafe',
    });

    expect(rows[0].metadata).toMatchObject({
      pricingAvailable: false,
      pricingSyncStatus: 'unsafe',
    });
    expect(rows[0].metadata).not.toHaveProperty('manualPricing');
    expect(rows[0].metadata).not.toHaveProperty('modelRatio');
    expect(rows[0].metadata).not.toHaveProperty('syncedPricing');
  });

  it('deduplicates repeated remote model ids', () => {
    const rows = normalizeNewapiSyncRows({
      models: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o', object: 'model' },
      ],
      pricing: [],
      pricingStatus: 'available',
    });

    expect(rows).toHaveLength(1);
  });

  it('does not emit rows for models missing from the latest upstream catalog', () => {
    const rows = normalizeNewapiSyncRows({
      models: [],
      pricing: [],
      pricingStatus: 'available',
    });

    expect(rows).toEqual([]);
  });

  it('preserves upstream group and pricing metadata during sync', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o', object: 'model' }],
      pricing: [
        {
          cache_ratio: 0.25,
          completion_ratio: 3,
          create_cache_ratio: 1.25,
          description: 'GPT 4o Pro',
          enable_groups: ['pro', 'vip'],
          model_name: 'gpt-4o',
          model_ratio: 15,
          quota_type: 0,
          supported_endpoint_types: ['chat_completions'],
        },
      ],
    });

    expect(rows[0].metadata).toMatchObject({
      completionRatio: 3,
      createCacheRatio: 1.25,
      cacheRatio: 0.25,
      enableGroups: ['pro', 'vip'],
      modelRatio: 15,
      pricingAvailable: true,
      quotaType: 0,
      supportedEndpointTypes: ['chat_completions'],
    });
  });

  it('combines exact system abilities with explicit upstream capability tags', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'system-capability-model', object: 'model' }],
      pricing: [
        {
          function_tags: 'Vision, Structured Output',
          model_name: 'system-capability-model',
        } as any,
      ],
    });

    expect(rows[0].metadata).toMatchObject({
      syncedAbilities: {
        functionCall: true,
        reasoning: true,
        structuredOutput: true,
        vision: true,
      },
      syncedAbilitySources: ['system-model-bank', 'upstream'],
    });
  });

  it('merges explicit abilities from both model and pricing payloads', () => {
    const rows = normalizeNewapiSyncRows({
      models: [{ abilities: { vision: true }, id: 'multi-source-model' }],
      pricing: [
        {
          capabilities: { function_calling: true, reasoning: true },
          model_name: 'multi-source-model',
        },
      ],
    });

    expect(rows[0].metadata.syncedAbilities).toEqual({
      functionCall: true,
      reasoning: true,
      vision: true,
    });
  });

  it('stores standardized pricing returned by Sub2API sync', () => {
    const syncedPricing = {
      units: [{ name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' }],
    } satisfies Pricing;
    const rows = normalizeNewapiSyncRows({
      models: [{ id: 'gpt-4o' }],
      pricing: [{ model_name: 'gpt-4o', resolvedPricing: syncedPricing }],
      syncSource: 'sub2api',
    });

    expect(rows[0].metadata).toMatchObject({
      pricingAvailable: true,
      syncedPricing,
      syncSource: 'sub2api',
    });
  });

  it('reads unambiguous Sub2API model-plaza prices for the authenticated key rate', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const body = url.endsWith('/v1/sub2api/billing')
        ? {
            billing_scope: 'token',
            group_rate_multiplier: 0.5,
            object: 'sub2api.key_billing',
            peak_rate_enabled: false,
            resolved_rate_multiplier: 0.25,
          }
        : {
            code: 0,
            data: {
              groups: [
                {
                  models: [
                    {
                      name: 'gpt-4o',
                      pricing: {
                        billing_mode: 'token',
                        cache_read_price: 0.0000005,
                        input_price: 0.000001,
                        output_price: 0.000002,
                      },
                    },
                  ],
                  rate_multiplier: 0.5,
                },
              ],
            },
          };

      return {
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: async () => JSON.stringify(body),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-sub2api',
        baseUrl: 'https://sub2api.example.com/v1',
        providerType: 'sub2api',
      }),
    ).resolves.toEqual({
      items: [
        {
          model_name: 'gpt-4o',
          resolvedPricing: {
            units: [
              { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
              {
                name: 'textInput_cacheRead',
                rate: 0.125,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
            ],
          },
        },
      ],
      status: 'available',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sub2api.example.com/v1/sub2api/billing',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-sub2api' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sub2api.example.com/api/v1/model-plaza',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('does not import a time-varying Sub2API peak price as a static rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => ({
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: async () =>
          JSON.stringify(
            url.endsWith('/v1/sub2api/billing')
              ? {
                  billing_scope: 'token',
                  group_rate_multiplier: 1,
                  object: 'sub2api.key_billing',
                  peak_rate_enabled: true,
                  resolved_rate_multiplier: 1,
                }
              : { code: 0, data: { groups: [] } },
          ),
      })),
    );

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-sub2api',
        baseUrl: 'https://sub2api.example.com',
        providerType: 'sub2api',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [],
        status: 'unsafe',
        warnings: expect.arrayContaining([expect.stringContaining('peak pricing')]),
      }),
    );
  });

  it('does not import Sub2API interval prices as a fixed commercial rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => ({
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: async () =>
          JSON.stringify(
            url.endsWith('/v1/sub2api/billing')
              ? {
                  billing_scope: 'token',
                  group_rate_multiplier: 1,
                  object: 'sub2api.key_billing',
                  peak_rate_enabled: false,
                  resolved_rate_multiplier: 1,
                }
              : {
                  code: 0,
                  data: {
                    groups: [
                      {
                        models: [
                          {
                            name: 'tiered-model',
                            pricing: {
                              billing_mode: 'token',
                              intervals: [
                                { input_price: 0.000001, max_tokens: 100_000 },
                                { input_price: 0.000002, max_tokens: null, min_tokens: 100_001 },
                              ],
                            },
                          },
                        ],
                        rate_multiplier: 1,
                      },
                    ],
                  },
                },
          ),
      })),
    );

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-sub2api',
        baseUrl: 'https://sub2api.example.com',
        providerType: 'sub2api',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [],
        status: 'unsafe',
        warnings: expect.arrayContaining([expect.stringContaining('cannot be represented safely')]),
      }),
    );
  });

  it('distinguishes unavailable pricing responses from valid empty pricing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        ok: true,
        text: async () => '<!doctype html><html></html>',
      }),
    );

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com/v1',
      }),
    ).resolves.toEqual(expect.objectContaining({ items: [], status: 'unavailable' }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: async () => JSON.stringify({ data: [], success: true }),
      }),
    );

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com/v1',
      }),
    ).resolves.toEqual({ items: [], status: 'available' });
  });

  it('returns no pricing without calling pricing endpoint for non-NewAPI providers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchNewapiPricing({
        apiKey: 'sk-test',
        baseUrl: 'https://siliconflow.example.com/v1',
        providerType: 'siliconflow',
      }),
    ).resolves.toEqual({ items: [], status: 'unsupported' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unsupported pricing sync for non-NewAPI providers', () => {
    expect(buildNewapiPricingSyncWarnings('siliconflow', 0)).toEqual([
      'Pricing sync is not supported for provider type siliconflow. Configure manual pricing in the model billing matrix.',
    ]);
  });

  it('keeps the NewAPI empty pricing endpoint warning', () => {
    expect(buildNewapiPricingSyncWarnings('newapi', 0, 'available')).toEqual([
      'Pricing endpoint returned no entries',
    ]);
  });

  it('reports pricing transport failures without treating them as an empty catalog', () => {
    expect(buildNewapiPricingSyncWarnings('newapi', 0, 'unavailable')).toEqual([
      'Pricing endpoint unavailable; existing pricing metadata was preserved',
    ]);
  });

  it('reports unsafe upstream pricing as cleared rather than cached', () => {
    expect(buildNewapiPricingSyncWarnings('sub2api', 0, 'unsafe')).toEqual([
      'Upstream prices that could not be represented safely were cleared',
    ]);
  });

  it('reports an explicitly disabled upstream pricing source', () => {
    expect(buildNewapiPricingSyncWarnings('newapi', 0, 'disabled')).toEqual([
      'Upstream pricing sync is disabled for this instance',
    ]);
  });

  it('does not duplicate the v1 segment when fetching models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [] }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewapiModels({
      apiKey: 'sk-test',
      baseUrl: 'https://newapi.example.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://newapi.example.com/v1/models',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer sk-test',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses Anthropic headers when fetching Claude-format models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [] }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewapiModels({
      apiKey: 'sk-claude',
      baseUrl: 'https://api.anthropic.com',
      providerType: 'claude',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: {
          'Accept': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'sk-claude',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('reports a clear error when the models endpoint returns html', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        ok: true,
        text: async () => '<!doctype html><html></html>',
      }),
    );

    await expect(
      fetchNewapiModels({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com/v1',
      }),
    ).rejects.toThrow(
      'AI provider models endpoint did not return JSON. Check that the base URL is an API endpoint.',
    );
  });

  it('rejects model responses that exceed the configured body limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'gpt-4o' }] }),
      }),
    );

    await expect(
      fetchNewapiModels({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com/v1',
        maxBodyBytes: 8,
      }),
    ).rejects.toThrow('AI provider models response exceeded the 8 byte limit');
  });

  it('reads response streams through the bounded body path', async () => {
    const releaseLock = vi.fn();
    const text = vi.fn().mockRejectedValue(new Error('unbounded text read'));
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(JSON.stringify({ data: [{ id: 'gpt-4o' }] })),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: { getReader: () => ({ cancel: vi.fn(), read, releaseLock }) },
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text,
      }),
    );

    await expect(
      fetchNewapiModels({
        apiKey: 'sk-test',
        baseUrl: 'https://newapi.example.com/v1',
      }),
    ).resolves.toEqual([{ id: 'gpt-4o' }]);
    expect(text).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('keeps the request timeout active while reading the response body', async () => {
    vi.useFakeTimers();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => ({
        headers: new Headers({ 'content-type': 'application/json' }),
        ok: true,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('The operation was aborted', 'AbortError')),
              { once: true },
            );
          }),
      })),
    );

    const request = fetchNewapiModels({
      apiKey: 'sk-test',
      baseUrl: 'https://newapi.example.com/v1',
      timeoutMs: 10,
    });
    const outcome = Promise.race([
      request.then(
        () => ({ status: 'resolved' as const }),
        (error: Error) => ({ error, status: 'rejected' as const }),
      ),
      new Promise<{ status: 'pending' }>((resolve) =>
        setTimeout(() => resolve({ status: 'pending' }), 50),
      ),
    ]);

    await vi.advanceTimersByTimeAsync(50);

    await expect(outcome).resolves.toMatchObject({
      error: new Error('AI provider models request timed out after 10ms'),
      status: 'rejected',
    });
  });
});
