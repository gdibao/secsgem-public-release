import { describe, expect, it } from 'vitest';

import { engineeringFacetVocabularySchema, engineeringToolSchema } from './schema';

const tool = {
  availability: 'Unconfigured',
  category: 'Piping',
  description: '',
  developerOnly: false,
  enabled: true,
  id: 'PG001',
  launchUrl: null,
  license: 'Check vendor terms',
  name: 'Example',
  section: 'process' as const,
  shape: 'web' as const,
  sortOrder: 1,
  sourceUrl: 'https://example.com/product',
  summary: '',
};

describe('engineering tool links', () => {
  it('accepts a public HTTPS source', () => {
    expect(engineeringToolSchema.safeParse(tool).success).toBe(true);
  });

  it.each([
    'https://localhost./tool',
    'https://host.local./tool',
    'https://host.internal./tool',
    'https://app.localhost/tool',
    'https://app.localhost.:8443/tool',
    'https://127.0.0.1/tool',
    'https://192.168.1.4/tool',
    'https://user:pass@example.com/tool',
    'http://example.com/tool',
    'javascript:alert(1)',
  ])('rejects a non-public navigation target: %s', (sourceUrl) => {
    expect(engineeringToolSchema.safeParse({ ...tool, sourceUrl }).success).toBe(false);
  });
});

describe('engineering facet bounds', () => {
  const vocabulary = {
    accessStates: [], forms: [], licenseTypes: [], maintainerNames: [], operatingSystems: [],
    pricingTypes: [], projectPhases: [], subsystems: [], vendorNames: [],
  };

  it('accepts more than 24 unique vendor names in a global vocabulary', () => {
    const vendorNames = Array.from({ length: 304 }, (_, index) => `Vendor ${index}`);
    expect(engineeringFacetVocabularySchema.safeParse({ ...vocabulary, vendorNames }).success).toBe(true);
    expect(engineeringToolSchema.safeParse({ ...tool, subsystems: vendorNames }).success).toBe(false);
  });

  it('rejects case-insensitive duplicate vocabulary terms and per-tool terms', () => {
    expect(engineeringFacetVocabularySchema.safeParse({ ...vocabulary, vendorNames: ['GF', 'gf'] }).success).toBe(false);
    expect(engineeringToolSchema.safeParse({ ...tool, supportedOS: ['Web', 'web'] }).success).toBe(false);
  });
});
