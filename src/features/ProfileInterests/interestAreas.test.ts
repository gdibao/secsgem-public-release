import { describe, expect, it } from 'vitest';

import { normalizeConfiguredInterestAreas } from './interestAreas';

describe('profile interest areas', () => {
  it('normalizes admin configured labels into stable selectable areas', () => {
    expect(
      normalizeConfiguredInterestAreas([
        'AI 绘画',
        { key: 'growth', label: '增长运营' },
        { key: 'growth', label: '重复' },
        '',
      ]),
    ).toEqual([
      { key: 'AI 绘画', label: 'AI 绘画' },
      { key: 'growth', label: '增长运营' },
    ]);
  });

  it('drops invalid configured values', () => {
    expect(normalizeConfiguredInterestAreas([null, 42, { key: '', label: '  ' }])).toEqual([]);
  });
});
