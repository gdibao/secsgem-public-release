import { isIP } from 'node:net';

import { z } from 'zod';

export const publicHttpsUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    hostname !== 'localhost' &&
    !hostname.endsWith('.localhost') &&
    hostname.includes('.') &&
    !isIP(hostname) &&
    !hostname.endsWith('.local') &&
    !hostname.endsWith('.internal') &&
    !hostname.endsWith('.test')
  );
}, 'A public HTTPS address is required');

export const toolIdSchema = z.string().regex(/^[a-z\d][\w-]{2,47}$/i);

const facetTerm = z.string().trim().min(1).max(100);
const uniqueTerms = (limit: number) => z.array(facetTerm).max(limit).refine(
  (terms) => new Set(terms.map((term) => term.toLocaleLowerCase())).size === terms.length,
  'Duplicate facet value',
);
const toolTerms = uniqueTerms(24);
const vocabularyTerms = uniqueTerms(2000);

export const engineeringFacetFieldsSchema = z.object({
  accessState: facetTerm.optional(),
  forms: toolTerms.optional(),
  licenseType: facetTerm.optional(),
  maintainerName: facetTerm.optional(),
  officialWebsiteUrl: publicHttpsUrl.optional(),
  pricingType: facetTerm.optional(),
  productUrl: publicHttpsUrl.optional(),
  publicReason: z.string().trim().max(500).optional(),
  projectPhases: toolTerms.optional(),
  purchaseUrl: publicHttpsUrl.optional(),
  subsystems: toolTerms.optional(),
  supportedOS: toolTerms.optional(),
  vendorName: facetTerm.optional(),
});

export const engineeringFacetVocabularySchema = z.object({
  accessStates: vocabularyTerms,
  aliases: z.record(z.string(), z.record(z.string(), uniqueTerms(12))).optional(),
  forms: vocabularyTerms,
  inactive: z.record(z.string(), vocabularyTerms).optional(),
  labels: z.record(z.string(), z.record(z.string(), facetTerm)).optional(),
  licenseTypes: vocabularyTerms,
  maintainerNames: vocabularyTerms,
  operatingSystems: vocabularyTerms,
  pricingTypes: vocabularyTerms,
  projectPhases: vocabularyTerms,
  subsystems: vocabularyTerms,
  vendorNames: vocabularyTerms,
});

export const engineeringToolSchema = z.object({
  ...engineeringFacetFieldsSchema.shape,
  availability: z.string().max(240),
  category: z.string().trim().min(1).max(100),
  description: z.string().max(4000),
  developerOnly: z.boolean(),
  enabled: z.boolean(),
  id: toolIdSchema,
  importBatchId: z.string().max(80).optional(),
  launchUrl: publicHttpsUrl.nullable(),
  license: z.string().max(1000),
  name: z.string().trim().min(1).max(180),
  section: z.enum(['process', 'automation', 'design']),
  shape: z.enum(['web', 'hybrid', 'windows', 'cross-platform', 'device-web', 'sdk', 'unknown']),
  sortOrder: z.number().int().min(0).max(100_000),
  sourceUrl: publicHttpsUrl,
  summary: z.string().max(1200),
});

export const engineeringMenuItemSchema = z.object({
  enabled: z.boolean(),
  key: z.enum(['image', 'ppt', 'community', 'catalog', 'favorites', 'local_mcp']),
  label: z.string().trim().min(1).max(40),
  path: z.string().regex(/^\/engineering-tools\?(?:section=(process|automation|design)|view=(catalog|favorites|local_mcp))$/),
  sortOrder: z.number().int().min(0).max(100),
});

export const engineeringMenuItemsSchema = z.array(engineeringMenuItemSchema).length(3).refine((items) => {
  const keys = new Set<string>(items.map((item) => item.key));
  const legacy = ['image', 'ppt', 'community'].every((key) => keys.has(key));
  const current = ['catalog', 'favorites', 'local_mcp'].every((key) => keys.has(key));
  return keys.size === 3 && (legacy || current) &&
    items.every((item) => current ? item.path === `/engineering-tools?view=${item.key}` :
      item.path.startsWith('/engineering-tools?section='));
}, 'Each menu must contain exactly one complete generation of routes');

export const engineeringMenuSchema = z.object({
  importBatchId: z.string().max(80).optional(),
  items: engineeringMenuItemsSchema,
  version: z.number().int().positive().optional(),
});

export type EngineeringTool = z.infer<typeof engineeringToolSchema>;
export type EngineeringMenu = z.infer<typeof engineeringMenuSchema>;
export type EngineeringFacetVocabulary = z.infer<typeof engineeringFacetVocabularySchema>;
