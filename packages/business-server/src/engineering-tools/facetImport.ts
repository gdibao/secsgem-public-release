import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { engineeringFacetFieldsSchema, engineeringFacetVocabularySchema, toolIdSchema } from './schema';

export const facetImportSchema = z.object({
  batchId: z.string().min(1).max(80),
  entries: z.array(z.object({
    id: toolIdSchema,
    ...engineeringFacetFieldsSchema.shape,
    maintainerName: engineeringFacetFieldsSchema.shape.maintainerName.nullable(),
    officialWebsiteUrl: engineeringFacetFieldsSchema.shape.officialWebsiteUrl.nullable(),
    productUrl: engineeringFacetFieldsSchema.shape.productUrl.nullable(),
    purchaseUrl: engineeringFacetFieldsSchema.shape.purchaseUrl.nullable(),
    vendorName: engineeringFacetFieldsSchema.shape.vendorName.nullable(),
  })).min(1).max(500),
  vocabularies: engineeringFacetVocabularySchema,
});

export const missingFacetFields = (current: Record<string, unknown>, incoming: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(incoming).filter(([key, value]) =>
    key !== 'id' && value !== undefined && value !== null && !Object.hasOwn(current, key),
  ));

export const revertImportedFields = (current: Record<string, unknown>, imported: Record<string, unknown>) => {
  const value = { ...current };
  let removed = 0;
  for (const [key, expected] of Object.entries(imported)) {
    if (!Object.hasOwn(value, key) || !isDeepStrictEqual(value[key], expected)) continue;
    delete value[key];
    removed++;
  }
  return { removed, value };
};

const sortedNames = (names: (string | undefined)[]) => [...new Set(names.filter(
  (name): name is string => !!name && name !== 'unknown',
))].sort((a, b) => a.localeCompare(b));

export const vocabularyFromImport = (input: z.infer<typeof facetImportSchema>) => ({
  ...input.vocabularies,
  maintainerNames: sortedNames([
    ...input.vocabularies.maintainerNames,
    ...input.entries.map((entry) => entry.maintainerName ?? undefined),
  ]),
  vendorNames: sortedNames([
    ...input.vocabularies.vendorNames,
    ...input.entries.map((entry) => entry.vendorName ?? undefined),
  ]),
});
