import { describe, expect, it } from 'vitest';

import { normalizePublicBrandName } from './publicBrand';

describe('normalizePublicBrandName', () => {
  it('trims configured names and falls back for blank values', () => {
    expect(normalizePublicBrandName('  Runtime Brand  ')).toBe('Runtime Brand');
    expect(normalizePublicBrandName('   ')).toBe('玄果AI');
    expect(normalizePublicBrandName(null)).toBe('玄果AI');
  });
});
