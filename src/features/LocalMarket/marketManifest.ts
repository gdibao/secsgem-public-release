import { type LocalMarketItem } from './types';

const qualityBase = '/market/quality';

const parseNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const fetchQualityManifest = async (
  kind: 'skills' | 'mcp',
  signal?: AbortSignal,
): Promise<LocalMarketItem[]> => {
  const response = await fetch(`${qualityBase}/${kind}/manifest.tsv`, {
    signal,
  });
  if (!response.ok) throw new Error(`quality manifest ${response.status}`);

  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const [header, ...rows] = lines;
  if (!header) return [];

  const columns = header.split('\t');
  // The mirror sorts manifests by the selected quality metric. Keep a bounded
  // client payload so a 50 MB raw skills list never enters the browser bundle.
  return rows.slice(0, 80).flatMap((line) => {
    const values = line.split('\t');
    const record = Object.fromEntries(columns.map((key, index) => [key, values[index] ?? '']));
    if (!record.identifier || !record.name) return [];

    return [
      {
        author: record.author || '精选市场',
        category: record.category || undefined,
        description: `本地精选 ${kind === 'skills' ? '技能' : 'MCP'}；数据来自每日同步的质量清单。安装包和运行权限需单独核验。`,
        homepage: record.homepage || record.github_url || undefined,
        id: record.identifier,
        installable: false,
        name: record.name,
        score: parseNumber(record.score),
        source: 'quality' as const,
        stars: parseNumber(record.stars),
      },
    ];
  });
};
