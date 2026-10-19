import { describe, expect, it } from 'vitest';

import { facetDisplayLabel, type FacetTool, filterEngineeringTools, UNKNOWN_FACET } from './facets';

const base = { category: 'test', developerOnly: false, summary: '' };
const tools: FacetTool[] = [
  { ...base, id: 'T-A', name: 'A', section: 'process', vendorName: 'GF', subsystems: ['UPW', '化学配管'], projectPhases: ['设计', '调试'], supportedOS: ['Windows', 'Web'], licenseType: '商业专有', pricingType: '免费', forms: ['web'] },
  { ...base, id: 'T-B', name: 'B', section: 'process', vendorName: 'Purolite', subsystems: ['UPW', '废水'], projectPhases: ['设计'], supportedOS: ['Web'], licenseType: '商业专有' },
  { ...base, id: 'T-C', name: 'C', section: 'process', subsystems: ['废水'], projectPhases: ['调试'], supportedOS: ['Linux'], licenseType: '开源', pricingType: '商业支持/订阅' },
  { ...base, id: 'T-D', name: 'D', section: 'process' },
  { ...base, id: 'T-E', name: 'E', section: 'process', vendorName: 'GF', subsystems: ['化学配管'], projectPhases: ['设计'], supportedOS: ['Windows'], licenseType: '商业专有', pricingType: '询价' },
  { ...base, id: 'T-F', name: 'F', section: 'automation', subsystems: ['监测'], projectPhases: ['调试'], supportedOS: ['Linux'], licenseType: '开源', pricingType: '免费' },
];

const ids = (selections: Parameters<typeof filterEngineeringTools>[1]['selections'], scope: 'all' | 'current' = 'current') =>
  filterEngineeringTools(tools, { developer: false, scope, search: '', section: 'process', selections }).map((tool) => tool.id);

describe('engineering tool facets', () => {
  it('uses runtime display labels without changing stable filter values', () => {
    const vocabulary = { labels: { projectPhases: { commissioning: '调试' }, licenseType: { proprietary: '商业专有' }, pricingType: { free: '免费' }, accessState: { catalog_only: '仅目录' } } };
    expect(facetDisplayLabel('projectPhases', 'commissioning', vocabulary)).toBe('调试');
    expect(facetDisplayLabel('licenseType', 'proprietary', vocabulary)).toBe('商业专有');
    expect(facetDisplayLabel('pricingType', 'free', vocabulary)).toBe('免费');
    expect(facetDisplayLabel('accessState', 'catalog_only', vocabulary)).toBe('仅目录');
    expect(facetDisplayLabel('supportedOS', 'Windows', vocabulary)).toBe('Windows');
    expect(ids({ projectPhases: ['调试'] })).toEqual(['T-A', 'T-C']);
  });
  it('ignores a stale hidden maintainer selection while retaining the metadata', () => {
    const withMaintainer = tools.map((tool, index) => ({ ...tool, maintainerName: index === 0 ? '维护方 A' : '维护方 B' }));
    const result = filterEngineeringTools(withMaintainer, {
      developer: false, scope: 'all', search: '', section: 'process',
      selections: { maintainerName: ['维护方 A'] },
    });
    expect(result).toHaveLength(withMaintainer.length);
    expect(result[0].maintainerName).toBe('维护方 A');
  });
  it('uses OR within a dimension and AND across dimensions without duplicate results', () => {
    expect(ids({ subsystems: ['UPW', '废水'], projectPhases: ['设计'], supportedOS: ['Web'] })).toEqual(['T-A', 'T-B']);
    expect(ids({ subsystems: ['UPW', '废水'], projectPhases: ['设计'] })).toEqual(['T-A', 'T-B']);
    expect(ids({ subsystems: ['UPW', '废水', '化学配管'], projectPhases: ['设计'] })).toEqual(['T-A', 'T-B', 'T-E']);
  });

  it.each(['subsystems', 'projectPhases', 'supportedOS', 'licenseType', 'pricingType'] as const)(
    'finds missing %s through the explicit unknown option', (dimension) => {
      expect(ids({ [dimension]: [UNKNOWN_FACET] })).toContain('T-D');
      expect(ids({ [dimension]: ['known'] })).not.toContain('T-D');
    },
  );

  it('keeps license and pricing independent', () => {
    expect(ids({ licenseType: ['开源'] })).toContain('T-C');
    expect(ids({ licenseType: ['开源'], pricingType: ['免费'] })).toEqual([]);
    expect(ids({ licenseType: ['商业专有'], pricingType: ['免费'] })).toEqual(['T-A']);
  });

  it('can search all three modules without changing the sidebar deep link', () => {
    expect(ids({ subsystems: ['监测'] })).toEqual([]);
    expect(ids({ subsystems: ['监测'] }, 'all')).toEqual(['T-F']);
    expect(ids({})).toHaveLength(5);
  });

  it('searches vendor aliases without merging distinct tool IDs', () => {
    const result = filterEngineeringTools(tools, {
      developer: false, scope: 'current', search: 'Georg Fischer', section: 'process', selections: {},
      vocabulary: { aliases: { vendorName: { GF: ['Georg Fischer'] } } },
    });
    expect(result.map((tool) => tool.id)).toEqual(['T-A', 'T-E']);
  });
});
