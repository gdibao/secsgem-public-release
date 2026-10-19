import { describe, expect, it } from 'vitest';

import { facetImportSchema, missingFacetFields, revertImportedFields, vocabularyFromImport } from './facetImport';

const vocabulary = {
  accessStates: [], forms: [], licenseTypes: [], maintainerNames: [], operatingSystems: [],
  pricingTypes: [], projectPhases: [], subsystems: [], vendorNames: [],
};

describe('facet import', () => {
  it('parses the researched catalog without changing old tools or null URLs', () => {
    const payload = facetImportSchema.parse({ batchId: 'sample', entries: [
      { id: 'PG001', vendorName: 'GF', subsystems: ['UPW'], officialWebsiteUrl: null },
    ], vocabularies: vocabulary });
    expect(missingFacetFields({ id: 'PG001', name: 'admin edit', vendorName: 'admin vendor' }, payload.entries[0]))
      .toEqual({ subsystems: ['UPW'] });
  });

  it('derives many vendor terms without a per-tool array limit', () => {
    const entries = Array.from({ length: 304 }, (_, index) => ({ id: `PG${String(index).padStart(3, '0')}`, vendorName: `Vendor ${index}` }));
    const parsed = facetImportSchema.parse({ batchId: 'sample', entries, vocabularies: vocabulary });
    expect(vocabularyFromImport(parsed).vendorNames).toHaveLength(304);
  });

  it('rolls back only still-matching imported fields', () => {
    const imported = { vendorName: 'GF', subsystems: ['UPW', '管路'] };
    expect(revertImportedFields({ id: 'PG001', name: 'unchanged', ...imported }, imported)).toEqual({
      removed: 2, value: { id: 'PG001', name: 'unchanged' },
    });
    expect(revertImportedFields({ id: 'PG001', name: 'admin edit', vendorName: 'new vendor', subsystems: ['UPW', '管路'] }, imported)).toEqual({
      removed: 1, value: { id: 'PG001', name: 'admin edit', vendorName: 'new vendor' },
    });
  });
});
