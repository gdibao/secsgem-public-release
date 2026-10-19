import { describe, expect, it } from 'vitest';

import { type ListItem } from './types';
import { getListItemKey } from './utils';

describe('getListItemKey', () => {
  it('includes provider ids in grouped model item keys', () => {
    const item: ListItem = {
      data: {
        displayName: 'GPT-4o',
        model: {
          abilities: {
            functionCall: true,
            reasoning: false,
            vision: true,
          },
          displayName: 'GPT-4o',
          id: 'gpt-4o',
        },
        providers: [
          {
            id: 'provider-a',
            name: 'Provider A',
          },
          {
            id: 'provider-b',
            name: 'Provider B',
          },
        ],
      },
      type: 'model-item-multiple',
    };

    expect(getListItemKey(item)).toBe('model:gpt-4o:GPT-4o:provider-a,provider-b');
  });

  it('uses model id to avoid collisions between equal grouped display names', () => {
    const createGroupedItem = (id: string): ListItem => ({
      data: {
        displayName: 'Chat Model',
        model: {
          abilities: {
            functionCall: true,
            reasoning: false,
            vision: true,
          },
          displayName: 'Chat Model',
          id,
        },
        providers: [
          {
            id: 'provider-a',
            name: 'Provider A',
          },
        ],
      },
      type: 'model-item-single',
    });

    expect(getListItemKey(createGroupedItem('chat-model-a'))).not.toBe(
      getListItemKey(createGroupedItem('chat-model-b')),
    );
  });

  it('keeps provider model item keys provider scoped', () => {
    const item: ListItem = {
      model: {
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        displayName: 'GPT-4o',
        id: 'gpt-4o',
      },
      provider: {
        children: [],
        id: 'provider-a',
        name: 'Provider A',
        source: 'builtin',
      },
      type: 'provider-model-item',
    };

    expect(getListItemKey(item)).toBe('provider-a-gpt-4o');
  });
});
