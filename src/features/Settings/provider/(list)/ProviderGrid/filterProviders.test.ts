import { describe, expect, it } from 'vitest';

import { filterUserVisibleProviders } from './filterProviders';

describe('filterUserVisibleProviders', () => {
  it('hides admin-managed custom providers from the user provider settings grid', () => {
    const providers = [
      { id: 'openai', source: 'builtin' },
      { id: 'admin-provider', source: 'custom' },
      { id: 'anthropic', source: 'builtin' },
    ];

    expect(filterUserVisibleProviders(providers).map((item) => item.id)).toEqual([
      'openai',
      'anthropic',
    ]);
  });
});
