export const UNKNOWN_FACET = '__unknown__';

export const facetDimensions = [
  'vendorName', 'maintainerName', 'subsystems', 'projectPhases', 'licenseType',
  'pricingType', 'supportedOS', 'forms', 'accessState',
] as const;

export type FacetDimension = (typeof facetDimensions)[number];
export const catalogFacetDimensions = facetDimensions.filter((dimension) => dimension !== 'maintainerName');
export type FacetSelections = Partial<Record<FacetDimension, string[]>>;
export type FacetVocabularyMetadata = {
  aliases?: Record<string, Record<string, string[]>>;
  labels?: Record<string, Record<string, string>>;
};

export const facetDisplayLabel = (dimension: FacetDimension, value: string, vocabulary?: FacetVocabularyMetadata) =>
  vocabulary?.labels?.[dimension]?.[value] || value;

export type FacetTool = {
  accessState?: string;
  category: string;
  developerOnly: boolean;
  forms?: string[];
  id: string;
  licenseType?: string;
  maintainerName?: string;
  name: string;
  pricingType?: string;
  projectPhases?: string[];
  section: string;
  subsystems?: string[];
  summary: string;
  supportedOS?: string[];
  vendorName?: string;
};

const toolValues = (tool: FacetTool, dimension: FacetDimension): string[] => {
  const value = tool[dimension];
  return Array.isArray(value) ? value : value ? [value] : [];
};

export const filterEngineeringTools = <T extends FacetTool>(tools: T[], options: {
  developer: boolean;
  scope: 'all' | 'current';
  search: string;
  section: string;
  selections: FacetSelections;
  vocabulary?: FacetVocabularyMetadata;
}): T[] => {
  const query = options.search.trim().toLocaleLowerCase();
  return tools.filter((tool) => {
    if (options.scope === 'current' && tool.section !== options.section) return false;
    if (!options.developer && tool.developerOnly) return false;
    const vendorAliases = options.vocabulary?.aliases?.vendorName?.[tool.vendorName ?? ''] ?? [];
    const vendorLabel = options.vocabulary?.labels?.vendorName?.[tool.vendorName ?? ''];
    if (query && ![
      tool.name, tool.id, tool.category, tool.summary, tool.vendorName, tool.maintainerName,
      vendorLabel, ...vendorAliases,
      ...toolValues(tool, 'subsystems'), ...toolValues(tool, 'projectPhases'),
    ].some((value) => value?.toLocaleLowerCase().includes(query))) return false;
    return catalogFacetDimensions.every((dimension) => {
      const selected = options.selections[dimension];
      if (!selected?.length) return true;
      const values = toolValues(tool, dimension);
      const unknown = values.every((value) => value === 'unknown');
      return selected.some((value) => value === UNKNOWN_FACET ? unknown : values.includes(value));
    });
  });
};
