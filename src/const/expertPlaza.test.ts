import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPERT_PLAZA_CONFIG, normalizeExpertPlazaConfig } from './expertPlaza';

describe('normalizeExpertPlazaConfig', () => {
  it('falls back to default categories when admin categories are empty', () => {
    const config = normalizeExpertPlazaConfig({
      cards: [],
      categories: [],
      enabled: true,
    });

    expect(config.categories).toEqual(DEFAULT_EXPERT_PLAZA_CONFIG.categories);
  });
});
