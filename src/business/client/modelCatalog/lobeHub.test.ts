import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';
import type {
  LobeHubModelCatalogPayload,
  LobeHubModelRatingsPayload,
} from '@/types/lobeHubModelCatalog';

import {
  buildLobeHubModelCatalogIndex,
  buildLobeHubModelRatingsIndex,
  isLobeHubProModel,
  mergeLobeHubModelDisplayMetadata,
  resolveLobeHubModelDisplayCard,
  resolveLobeHubModelRating,
} from './lobeHub';

const catalog: LobeHubModelCatalogPayload = {
  models: [
    {
      abilities: { functionCall: true, reasoning: true, vision: true },
      contextWindowTokens: 1_000_000,
      description: 'Official model description',
      displayName: 'Claude Sonnet 4.6',
      id: 'claude-sonnet-4-6',
    },
  ],
  proModels: ['claude-sonnet-4-6'],
};

describe('LobeHub model catalog helpers', () => {
  it('matches exact and namespaced model IDs without matching arbitrary suffixes', () => {
    const index = buildLobeHubModelCatalogIndex(catalog);

    expect(resolveLobeHubModelDisplayCard('claude-sonnet-4-6', index)?.contextWindowTokens).toBe(
      1_000_000,
    );
    expect(isLobeHubProModel('router/claude-sonnet-4-6', index)).toBe(true);
    expect(isLobeHubProModel('prefix.claude-sonnet-4-6', index)).toBe(true);
    expect(isLobeHubProModel('my-claude-sonnet-4-6', index)).toBe(false);
  });

  it('fills missing display metadata while preserving provider overrides', () => {
    const enabledList: EnabledProviderWithModels[] = [
      {
        children: [
          {
            abilities: { vision: false },
            displayName: 'Provider display name',
            id: 'router/claude-sonnet-4-6',
          },
        ],
        id: 'newapi',
        name: 'NewAPI',
        source: 'custom',
      },
    ];

    const merged = mergeLobeHubModelDisplayMetadata(enabledList, catalog);
    const model = merged[0].children[0];

    expect(model).toMatchObject({
      abilities: { functionCall: true, reasoning: true, vision: false },
      contextWindowTokens: 1_000_000,
      description: 'Official model description',
      displayName: 'Provider display name',
    });
    expect(merged).not.toBe(enabledList);
  });

  it('resolves capability ratings for namespaced model IDs', () => {
    const payload: LobeHubModelRatingsPayload = {
      ratings: {
        'claude-sonnet-4-6': {
          intelligence: {
            score: 20,
            source: 'lobehub',
            sourceUrl: 'https://lobehub.com',
            updatedAt: '2026-08-08',
          },
        },
      },
    };

    const rating = resolveLobeHubModelRating(
      'newapi:claude-sonnet-4-6',
      buildLobeHubModelRatingsIndex(payload),
    );

    expect(rating?.intelligence?.score).toBe(20);
  });
});
