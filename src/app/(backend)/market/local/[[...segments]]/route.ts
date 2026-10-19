import { type NextRequest, NextResponse } from 'next/server';

import fabCatalog from '@/features/LocalAssistantMarket/catalog.json';

type RouteContext = { params: Promise<{ segments?: string[] }> };
type Kind = 'assistant' | 'mcp' | 'skill';
type Installability = 'installable' | 'needs-config' | 'metadata-only' | 'blocked';

type MarketItem = {
  author?: string;
  avatar?: string;
  category?: string;
  description?: string;
  featured?: boolean;
  homepage?: string;
  iconKey: string;
  id: string;
  installable: boolean;
  installCount?: number;
  kind: Kind;
  license?: string;
  missing?: string[];
  name: string;
  ratingCount?: number;
  score?: number;
  source: 'local-mirror';
  sourceId: string;
  sha256?: string;
  stars?: number;
  status: Installability;
  tags?: string[];
  updatedAt?: string;
  version?: string;
  official?: boolean;
  permissions?: string[];
  toolsCount?: number;
  transport?: string;
  validated?: boolean;
};

type MirrorRecord = { identifier?: string; meta?: Record<string, unknown> };
type MarketIndex = { details: Map<string, MirrorRecord>; items: MarketItem[] };

const CACHE_TTL_MS = 15 * 60 * 1000;
const marketCache = new Map<string, { expiresAt: number; value: MarketIndex }>();
const marketLoads = new Map<string, Promise<MarketIndex>>();

const qualityBase = () =>
  (process.env.FAB_LOCAL_QUALITY_BASE_URL || 'https://fab.secsgem.com.cn/market/quality').replace(
    /\/$/,
    '',
  );
const installableBase = () =>
  (
    process.env.FAB_LOCAL_INSTALLABLE_BASE_URL ||
    'https://fab.secsgem.com.cn/market/installable-current'
  ).replace(/\/$/, '');
const mirrorApiBase = () => {
  const value = process.env.FAB_LOCAL_MARKET_API_BASE_URL?.trim();
  if (!value) throw new Error('FAB local market API is not configured');
  return value.replace(/\/$/, '');
};

const mirrorApiHeaders = () => {
  const token = process.env.FAB_LOCAL_MARKET_API_TOKEN?.trim();
  if (!token) throw new Error('FAB local market server token is not configured');
  return { 'x-fab-market-token': token };
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const fabIds = new Set(
  (
    fabCatalog as Array<{ identifier?: string; sourceId?: string; meta?: { title?: string } }>
  ).flatMap(
    (entry) => [entry.identifier, entry.sourceId, entry.meta?.title].filter(Boolean) as string[],
  ),
);

const isFabDuplicate = (id: string, name: string) =>
  fabIds.has(id) || fabIds.has(name) || /^(?:c150-|semi-)/.test(id);

const jsonLines = (input: string): MirrorRecord[] =>
  input
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as MirrorRecord;
        return value && typeof value === 'object' ? [value] : [];
      } catch {
        return [];
      }
    });

const manifestRows = (input: string): MirrorRecord[] => {
  const [headerLine, ...lines] = input.split(/\r?\n/).filter(Boolean);
  const headers = headerLine?.split('\t') || [];
  return lines.flatMap((line) => {
    const values = line.split('\t');
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    if (!row.identifier || !row.name) return [];
    const stars = Number(row.stars);
    const score = Number(row.score);
    return [
      {
        identifier: row.identifier,
        meta: {
          name: row.name,
          author: row.author,
          category: row.category,
          homepage: row.homepage || row.github_url,
          ...(Number.isFinite(stars) && row.stars ? { github: { stars } } : {}),
          ...(Number.isFinite(score) && row.score ? { score } : {}),
        },
      },
    ];
  });
};

const installableRecord = (kind: Kind, value: unknown): MarketItem | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const sourceId = text(row.id).trim();
  const name = text(row.name).trim();
  const status = row.status;
  const sourceTrust =
    row.sourceTrust && typeof row.sourceTrust === 'object'
      ? (row.sourceTrust as Record<string, unknown>)
      : {};
  if (!sourceId || !name || (status !== 'installable' && status !== 'needs-config'))
    return undefined;

  return {
    author: text(row.author) || undefined,
    avatar: text(row.avatar) || undefined,
    category: text(row.category) || undefined,
    description: text(row.description) || 'LobeHub 市场本地内容包。',
    featured: Boolean(sourceTrust.featured || sourceTrust.official || sourceTrust.validated),
    iconKey: `local:content:${kind}:${sourceId}:${text(row.version) || text(row.sha256).slice(0, 12)}`,
    id: `local:${kind}:${sourceId}`,
    installable: row.installable === true,
    kind,
    license: text(row.license) || undefined,
    missing: Array.isArray(row.warnings)
      ? row.warnings.filter((item): item is string => typeof item === 'string')
      : [],
    name,
    installCount: number(row.installCount),
    official: Boolean(sourceTrust.official),
    permissions: Array.isArray(row.permissions)
      ? row.permissions.filter((item): item is string => typeof item === 'string')
      : [],
    sha256: text(row.sha256) || undefined,
    ratingCount: number(row.ratingCount),
    score: number(row.score),
    source: 'local-mirror',
    sourceId,
    status,
    toolsCount: number(row.toolsCount),
    transport: text(row.transport) || undefined,
    updatedAt: text(row.updatedAt) || undefined,
    validated:
      typeof sourceTrust.validated === 'boolean'
        ? sourceTrust.validated
        : typeof row.validated === 'boolean'
          ? row.validated
          : undefined,
    version: text(row.version) || undefined,
  };
};

const qualityRecord = (kind: Kind, row: MirrorRecord): MarketItem | undefined => {
  const meta = row.meta || {};
  const sourceId = text(row.identifier || meta.identifier).trim();
  const name = text(meta.name || meta.title || sourceId).trim();
  if (!sourceId || !name) return undefined;

  const github = (meta.github && typeof meta.github === 'object' ? meta.github : {}) as Record<
    string,
    unknown
  >;
  const config = (meta.config && typeof meta.config === 'object' ? meta.config : {}) as Record<
    string,
    unknown
  >;
  const pluginCount =
    number(meta.pluginCount) || (Array.isArray(config.plugins) ? config.plugins.length : 0);
  const knowledgeCount = number(meta.knowledgeCount) || 0;
  const hasNativeAgentConfig = kind === 'assistant' && text(config.systemRole).trim().length > 0;
  const missing: string[] = [];
  let status: Installability = 'metadata-only';

  if (String(meta.status || '').toLowerCase() === 'blocked') {
    status = 'blocked';
    missing.push('镜像记录标记为阻断，需在 Fab 内重新核验');
  } else if (kind === 'assistant' && hasNativeAgentConfig) {
    if (pluginCount > 0 || knowledgeCount > 0) {
      status = 'needs-config';
      if (pluginCount > 0) missing.push('依赖外部插件或工具，需在 Fab 内单独配置');
      if (knowledgeCount > 0) missing.push('原知识库未随镜像离线提供');
    } else {
      status = 'installable';
    }
  } else if (kind !== 'assistant') {
    missing.push('本地质量包只有详情清单，没有可再分发的离线内容包或 Fab 连接器定义');
  } else {
    missing.push('缺少可映射到 Fab 原生助手的完整 systemRole/config');
  }

  const stars = number(github.stars ?? meta.stars);
  const featured =
    Boolean(meta.isFeatured) || Boolean(meta.isOfficial) || (stars !== undefined && stars >= 50);

  const authorValue =
    meta.author && typeof meta.author === 'object'
      ? (meta.author as Record<string, unknown>).name
      : meta.author;

  return {
    author: text(authorValue) || undefined,
    avatar: text(meta.avatar || meta.icon) || undefined,
    category: text(meta.category) || undefined,
    description: text(meta.description) || '本地镜像条目，详情和运行能力需按状态核验。',
    featured,
    homepage: text(meta.homepage || github.url) || undefined,
    iconKey: `local:official-mirror:${kind}:${sourceId}:${text(meta.versionName || meta.versionNumber || meta.version) || 'unknown'}`,
    id: `local:${kind}:${sourceId}`,
    installable: status === 'installable',
    installCount: number(meta.installCount),
    kind,
    missing,
    name,
    official: Boolean(meta.isOfficial),
    ratingCount: number(meta.ratingCount || meta.commentCount),
    score: number(meta.score),
    source: 'local-mirror',
    sourceId,
    stars,
    status,
    tags: Array.isArray(meta.tags)
      ? meta.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    updatedAt: text(meta.updatedAt || meta.updated_at) || undefined,
    validated: typeof meta.isValidated === 'boolean' ? meta.isValidated : undefined,
    version: text(meta.versionName || meta.versionNumber || meta.version) || undefined,
  };
};

const fetchItemsUncached = async (
  kind: Kind,
  catalog: 'installable' | 'reference',
): Promise<MarketIndex> => {
  if (catalog === 'installable' && kind === 'assistant') {
    const response = await fetch(`${installableBase()}/assistant/catalog.json`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`local assistant installable catalog ${response.status}`);
    const body = (await response.json()) as { items?: unknown[] };
    const details = new Map<string, MirrorRecord>();
    const items = (body.items || []).flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      const item = installableRecord('assistant', record);
      if (!item || isFabDuplicate(item.sourceId, item.name)) return [];
      details.set(item.sourceId, { identifier: item.sourceId, meta: record });
      return [item];
    });
    return { details, items };
  }

  if (catalog === 'installable' && kind === 'skill') {
    const url = `${installableBase()}/catalog.json`;
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (!response.ok) throw new Error(`local ${kind} installable catalog ${response.status}`);
    const body = (await response.json()) as { items?: unknown[] };
    const details = new Map<string, MirrorRecord>();
    const items = (body.items || []).flatMap((row) => {
      const item = installableRecord(kind, row);
      if (!item) return [];
      details.set(item.sourceId, {
        identifier: item.sourceId,
        meta: row as Record<string, unknown>,
      });
      return [item];
    });
    return { details, items };
  }

  const folder = kind === 'assistant' ? 'agent' : kind === 'skill' ? 'skills' : 'mcp';
  const filename = kind === 'assistant' ? 'list.jsonl' : 'manifest.tsv';
  const response = await fetch(`${qualityBase()}/${folder}/${filename}`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`local ${kind} quality list ${response.status}`);
  const input = await response.text();
  const rows = kind === 'assistant' ? jsonLines(input) : manifestRows(input);
  const details = new Map<string, MirrorRecord>();
  const items = rows.flatMap((row) => {
    const item = qualityRecord(kind, row);
    if (!item || (kind === 'assistant' && isFabDuplicate(item.sourceId, item.name))) return [];
    details.set(item.sourceId, row);
    return [item];
  });
  return { items, details };
};

const sortItems = (items: MarketItem[]) =>
  [...items].sort((a, b) => {
    const featured = Number(b.featured) - Number(a.featured);
    if (featured) return featured;
    const stars = (b.stars || -1) - (a.stars || -1);
    if (stars) return stars;
    const score = (b.score || -1) - (a.score || -1);
    if (score) return score;
    const usage = (b.installCount || -1) - (a.installCount || -1);
    if (usage) return usage;
    return `${a.name}:${a.sourceId}`.localeCompare(`${b.name}:${b.sourceId}`, 'zh-CN');
  });

const mirrorMcpRecord = (value: unknown): MarketItem | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const sourceId = text(row.identifier).trim();
  const name = text(row.name || row.identifier).trim();
  const deploymentStatus = text(row.deploymentStatus);
  if (!sourceId || !name) return undefined;
  const status: Installability =
    deploymentStatus === 'remote-configurable'
      ? row.hasConfigSchema
        ? 'needs-config'
        : 'installable'
      : deploymentStatus === 'runner-required'
        ? 'needs-config'
        : 'metadata-only';
  return {
    author: text(row.author) || undefined,
    avatar: text(row.avatar || row.icon) || undefined,
    category: text(row.category) || undefined,
    description: text(row.description) || 'LobeHub 市场本地镜像 MCP。',
    featured: Boolean(row.isFeatured),
    homepage: text(row.homepage || row.repository) || undefined,
    iconKey: `local:mirror:mcp:${sourceId}:${text(row.version) || 'unknown'}`,
    id: `local:mcp:${sourceId}`,
    installable: status === 'installable' || status === 'needs-config',
    installCount: number(row.installCount),
    kind: 'mcp',
    missing: status === 'metadata-only' ? ['缺少可执行 deployment definition'] : [],
    name,
    official: Boolean(row.isOfficial),
    ratingCount: number(row.ratingCount),
    score: number(row.ratingAverage),
    source: 'local-mirror',
    sourceId,
    status,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    toolsCount: number(row.toolsCount),
    transport: Array.isArray(row.deploymentTypes) ? row.deploymentTypes.join(',') : undefined,
    updatedAt: text(row.updatedAt) || undefined,
    validated: typeof row.isValidated === 'boolean' ? row.isValidated : undefined,
    version: text(row.version) || undefined,
  };
};

const fetchMirrorMcpPage = async (params: URLSearchParams) => {
  const upstream = new URL(`${mirrorApiBase()}/plugins`);
  upstream.searchParams.set('includePlatform', '0');
  upstream.searchParams.set('page', params.get('page') || '1');
  upstream.searchParams.set('pageSize', params.get('limit') || '80');
  if (params.get('q')) upstream.searchParams.set('q', params.get('q')!);
  const response = await fetch(upstream, { cache: 'no-store', headers: mirrorApiHeaders() });
  if (!response.ok) throw new Error(`local MCP mirror returned ${response.status}`);
  const body = (await response.json()) as {
    currentPage?: number;
    items?: unknown[];
    pageSize?: number;
    totalCount?: number;
  };
  return {
    items: (body.items || []).flatMap((row) => mirrorMcpRecord(row) || []),
    page: body.currentPage || 1,
    pageSize: body.pageSize || Number(params.get('limit') || 80),
    total: body.totalCount || 0,
  };
};

const enrichCuratedMcpPage = async (items: MarketItem[]) => {
  if (!items.length) return items;
  const upstream = new URL(`${mirrorApiBase()}/plugins/batch`);
  upstream.searchParams.set('identifiers', items.map((item) => item.sourceId).join(','));
  const response = await fetch(upstream, { cache: 'no-store', headers: mirrorApiHeaders() });
  if (!response.ok) throw new Error(`local MCP mirror batch returned ${response.status}`);
  const body = (await response.json()) as { items?: unknown[] };
  const deploymentById = new Map(
    (body.items || []).flatMap((row) => {
      const item = mirrorMcpRecord(row);
      return item ? [[item.sourceId, item] as const] : [];
    }),
  );
  return items.map((item) => deploymentById.get(item.sourceId) || item);
};

const fetchItems = async (
  kind: Kind,
  catalog: 'installable' | 'reference',
): Promise<MarketIndex> => {
  const cacheKey = `${kind}:${catalog}`;
  const cached = marketCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const currentLoad = marketLoads.get(cacheKey);
  if (currentLoad) return currentLoad;

  const load = fetchItemsUncached(kind, catalog)
    .then(({ details, items }) => {
      const value = { details, items: sortItems(items) };
      marketCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => marketLoads.delete(cacheKey));
  marketLoads.set(cacheKey, load);
  return load;
};

const handle = async (request: NextRequest, context: RouteContext) => {
  const { segments } = await context.params;
  const kindMap: Record<string, Kind> = { assistants: 'assistant', mcp: 'mcp', skills: 'skill' };
  const normalizedKind = segments?.[0] ? kindMap[segments[0]] : undefined;
  if (!normalizedKind)
    return NextResponse.json({ error: 'unsupported_market_kind' }, { status: 404 });

  try {
    const params = new URL(request.url).searchParams;
    const catalog = params.get('view') === 'reference' ? 'reference' : 'installable';
    const showAll = params.get('all') === '1';
    const query = params.get('q')?.trim().toLocaleLowerCase() || '';
    const selectedId = segments?.[1];
    if (normalizedKind === 'mcp' && catalog === 'installable' && selectedId) {
      const response = await fetch(
        `${mirrorApiBase()}/plugins/${encodeURIComponent(decodeURIComponent(selectedId))}/manifest`,
        { cache: 'no-store', headers: mirrorApiHeaders() },
      );
      if (response.status === 404)
        return NextResponse.json({ error: 'market_item_not_found' }, { status: 404 });
      if (!response.ok) throw new Error(`local MCP mirror manifest returned ${response.status}`);
      const manifest = (await response.json()) as Record<string, unknown>;
      const item = mirrorMcpRecord(manifest);
      if (!item) return NextResponse.json({ error: 'market_item_not_found' }, { status: 404 });
      return NextResponse.json({ item, manifest });
    }
    if (normalizedKind === 'mcp' && catalog === 'installable' && (showAll || query)) {
      const result = await fetchMirrorMcpPage(params);
      return NextResponse.json(
        { ...result, all: showAll, kind: 'mcp', source: 'local-mirror', view: catalog },
        { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' } },
      );
    }
    const { items, details } = await fetchItems(normalizedKind, catalog);
    const pageSize = Math.min(Math.max(Number(params.get('limit') || 80), 1), 200);
    const page = Math.max(Number(params.get('page') || 1), 1);
    const queryMatches = items.filter(
      (item) =>
        !query ||
        [item.sourceId, item.name, item.description, item.author, ...(item.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
    );
    let filtered =
      showAll || catalog === 'installable'
        ? queryMatches
        : queryMatches.filter((item) => item.featured);
    if (!showAll && filtered.length === 0) {
      filtered = queryMatches.filter((item) =>
        normalizedKind === 'assistant'
          ? item.status === 'installable'
          : item.official || item.validated || item.score !== undefined || item.stars !== undefined,
      );
    }
    if (selectedId) {
      const item = items.find((entry) => entry.sourceId === decodeURIComponent(selectedId));
      const raw = item ? details.get(item.sourceId) : undefined;
      if (!item || !raw)
        return NextResponse.json({ error: 'market_item_not_found' }, { status: 404 });
      const meta = raw.meta || {};
      const config = (meta.config && typeof meta.config === 'object' ? meta.config : {}) as Record<
        string,
        unknown
      >;
      return NextResponse.json({
        item,
        config: item.installable
          ? {
              openingMessage: config.openingMessage,
              openingQuestions: config.openingQuestions,
              systemRole: config.systemRole,
            }
          : undefined,
      });
    }

    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);
    const resolvedItems =
      normalizedKind === 'mcp' && catalog === 'installable'
        ? await enrichCuratedMcpPage(pageItems)
        : pageItems;
    return NextResponse.json(
      {
        items: resolvedItems,
        kind: normalizedKind,
        source: 'local-mirror',
        page,
        pageSize,
        total: filtered.length,
        all: showAll,
        view: catalog,
      },
      { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'local_market_unavailable',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
};

export const GET = handle;
export const dynamic = 'force-dynamic';
