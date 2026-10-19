import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLobeHubModelCatalog,
  getLobeHubModelRatings,
  invalidateLobeHubModelCatalogCache,
} from './lobeHubModelCatalog';

const validCatalog = {
  models: [
    {
      abilities: { reasoning: true, vision: true },
      contextWindowTokens: 1_000_000,
      description: 'Official description',
      id: 'claude-sonnet-4-6',
      pricing: { shouldNotLeak: true },
    },
  ],
  proModels: ['claude-sonnet-4-6'],
  version: 2,
};

const validRatings = {
  ratings: {
    'claude-sonnet-4-6': {
      intelligence: {
        score: 20,
        source: 'lobehub',
        sourceUrl: 'https://lobehub.com/models/claude-sonnet-4-6',
        updatedAt: '2026-08-08',
      },
    },
  },
};

describe('LobeHub model catalog service', () => {
  beforeEach(() => {
    invalidateLobeHubModelCatalogCache();
  });

  afterEach(() => {
    invalidateLobeHubModelCatalogCache();
    vi.unstubAllGlobals();
  });

  it('validates, sanitizes, and caches official model display metadata', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      json: async () => (url.includes('ratings') ? validRatings : validCatalog),
      ok: true,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [catalog, ratings] = await Promise.all([
      getLobeHubModelCatalog(),
      getLobeHubModelRatings(),
    ]);

    expect(catalog).toEqual({
      models: [
        {
          abilities: { reasoning: true, vision: true },
          contextWindowTokens: 1_000_000,
          description: 'Official description',
          id: 'claude-sonnet-4-6',
        },
      ],
      proModels: ['claude-sonnet-4-6'],
      version: 2,
    });
    expect(ratings?.ratings['claude-sonnet-4-6'].intelligence?.score).toBe(20);

    await getLobeHubModelCatalog();
    await getLobeHubModelRatings();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when the official payload has no usable entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ models: [], proModels: [] }), ok: true }),
    );

    await expect(getLobeHubModelCatalog()).resolves.toBeUndefined();
  });
});
