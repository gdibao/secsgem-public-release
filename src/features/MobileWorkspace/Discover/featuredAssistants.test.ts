import { describe, expect, it } from 'vitest';

import type { MobileResolvedFeaturedAssistantV1 } from '@/const/mobileConfig';

import { buildFeaturedAssistantCards } from './featuredAssistants';

describe('buildFeaturedAssistantCards', () => {
  it('builds encoded community routes without adding filler cards', () => {
    const assistants: MobileResolvedFeaturedAssistantV1[] = [
      {
        description: 'Planning',
        identifier: 'planning/assistant',
        model: { displayName: 'GPT 4.1', id: 'gpt-4.1', provider: 'openai' },
        title: 'Planner',
      },
    ];

    expect(buildFeaturedAssistantCards(assistants)).toEqual([
      { ...assistants[0], routePath: '/community/agent/planning%2Fassistant' },
    ]);
  });
});
