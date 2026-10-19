import { createHash } from 'node:crypto';

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface LocalSkillCatalogItem {
  description: string;
  id: string;
  installable: boolean;
  license: string;
  name: string;
  packagePath: string;
  permissions: string[];
  sha256: string;
  sourceId: string;
  status: 'installable' | 'needs-config';
  version: string;
  warnings: string[];
}

export interface LocalMcpCatalogItem {
  auth: 'none' | 'server-managed' | 'user-config';
  deployment?: {
    connection?: {
      configSchema?: Record<string, unknown>;
      type?: 'http' | 'stdio';
      url?: string;
    };
    runner?: string;
  };
  description: string;
  id: string;
  installable: boolean;
  name: string;
  permissions: string[];
  sourceId: string;
  status: 'installable' | 'needs-config';
  toolsCount?: number;
  transport: 'http' | 'stdio';
  validated: boolean;
  version: string;
}

let cache: { expiresAt: number; items: LocalSkillCatalogItem[] } | undefined;
let mcpCache: { expiresAt: number; items: LocalMcpCatalogItem[] } | undefined;

const catalogBase = () => {
  const value = process.env.FAB_LOCAL_INSTALLABLE_BASE_URL?.trim();
  if (!value) throw new Error('FAB local installable catalog is not configured');
  return value.replace(/\/$/, '');
};

const publicCatalogBase = () =>
  (process.env.FAB_LOCAL_INSTALLABLE_PUBLIC_URL || 'https://fab.gdibao.com/market/installable-current')
    .trim()
    .replace(/\/$/, '');

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

const assertCatalogItem = (value: unknown): value is LocalSkillCatalogItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    /^[a-z0-9._-]{1,255}$/.test(item.id) &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    typeof item.license === 'string' &&
    typeof item.version === 'string' &&
    typeof item.packagePath === 'string' &&
    /^skills\/[a-z0-9._-]+\/[a-f0-9]{64}\.zip$/.test(item.packagePath) &&
    typeof item.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    (item.status === 'installable' || item.status === 'needs-config') &&
    typeof item.installable === 'boolean' &&
    Array.isArray(item.permissions) &&
    Array.isArray(item.warnings)
  );
};

const assertMcpCatalogItem = (value: unknown): value is LocalMcpCatalogItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const deployment = item.deployment;
  const connection = deployment && typeof deployment === 'object'
    ? (deployment as Record<string, unknown>).connection
    : undefined;
  const connectionType = connection && typeof connection === 'object'
    ? (connection as Record<string, unknown>).type
    : undefined;
  return (
    typeof item.id === 'string' &&
    /^[a-z0-9._-]{1,255}$/.test(item.id) &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    typeof item.sourceId === 'string' &&
    typeof item.version === 'string' &&
    (item.status === 'installable' || item.status === 'needs-config') &&
    item.installable === true &&
    (item.transport === 'http' || item.transport === 'stdio') &&
    (item.auth === 'none' || item.auth === 'server-managed' || item.auth === 'user-config') &&
    Array.isArray(item.permissions) &&
    typeof item.validated === 'boolean' &&
    connectionType === item.transport
  );
};

export const listLocalSkillCatalog = async (): Promise<LocalSkillCatalogItem[]> => {
  if (cache && cache.expiresAt > Date.now()) return cache.items;
  const response = await fetch(`${catalogBase()}/catalog.json`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Fab local skill catalog returned ${response.status}`);
  const body = (await response.json()) as { items?: unknown[] };
  const items = (body.items || []).filter(assertCatalogItem);
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, items };
  return items;
};

export const listLocalMcpCatalog = async (): Promise<LocalMcpCatalogItem[]> => {
  if (mcpCache && mcpCache.expiresAt > Date.now()) return mcpCache.items;
  const response = await fetch(`${catalogBase()}/mcp/catalog.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Fab local MCP catalog returned ${response.status}`);
  const body = (await response.json()) as { items?: unknown[] };
  const items = (body.items || []).filter(assertMcpCatalogItem);
  mcpCache = { expiresAt: Date.now() + CACHE_TTL_MS, items };
  return items;
};

const localMcpFromManifest = (value: unknown): LocalMcpCatalogItem | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const identifier = typeof row.identifier === 'string' ? row.identifier : '';
  const options = Array.isArray(row.deploymentOptions) ? row.deploymentOptions : [];
  const deployments = options.flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const connection = (option as Record<string, unknown>).connection;
    if (!connection || typeof connection !== 'object') return [];
    const typed = connection as Record<string, unknown>;
    if (typed.type === 'http' && typeof typed.url === 'string') return [{ connection: typed }];
    if (typed.type === 'stdio' && typeof typed.command === 'string') return [{ connection: typed }];
    return [];
  });
  const remote = deployments.find((item) => item.connection.type === 'http');
  const stdio = deployments.find((item) => item.connection.type === 'stdio');
  const selected = remote || stdio;
  if (!identifier || !selected) return undefined;
  const hasConfig = Boolean(selected.connection.configSchema);
  return {
    auth: hasConfig ? 'user-config' : 'none',
    deployment: {
      connection: {
        configSchema: selected.connection.configSchema as Record<string, unknown> | undefined,
        type: selected.connection.type as 'http' | 'stdio',
        url: typeof selected.connection.url === 'string' ? selected.connection.url : undefined,
      },
      ...(selected.connection.type === 'stdio' ? { runner: 'onlyboxes-required' } : {}),
    },
    description: typeof row.description === 'string' ? row.description : '',
    id: identifier,
    installable: true,
    name: typeof row.name === 'string' ? row.name : identifier,
    permissions: [],
    sourceId: identifier,
    status: hasConfig || selected.connection.type === 'stdio' ? 'needs-config' : 'installable',
    toolsCount: typeof row.toolsCount === 'number' ? row.toolsCount : undefined,
    transport: selected.connection.type as 'http' | 'stdio',
    validated: row.isValidated === true,
    version: typeof row.version === 'string' ? row.version : 'unknown',
  };
};

export const getLocalMcpCatalogItem = async (identifier: string): Promise<LocalMcpCatalogItem> => {
  const staticItem = (await listLocalMcpCatalog()).find((candidate) => candidate.id === identifier);
  if (staticItem) return staticItem;
  const response = await fetch(`${mirrorApiBase()}/plugins/${encodeURIComponent(identifier)}/manifest`, {
    cache: 'no-store',
    headers: mirrorApiHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Fab local MCP manifest returned ${response.status}`);
  const item = localMcpFromManifest(await response.json());
  if (!item) throw new Error('Fab local MCP deployment definition is incomplete');
  return item;
};

const envPrefixForMcp = (identifier: string) =>
  `FAB_LOCAL_MCP_${identifier.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

export const resolveLocalMcpDeployment = async (identifier: string) => {
  const item = await getLocalMcpCatalogItem(identifier);
  const connection = item.deployment?.connection;
  if (!connection || connection.type !== item.transport)
    throw new Error('Fab local MCP deployment definition is incomplete');
  if (item.transport !== 'http')
    throw new Error('Fab local MCP requires a configured isolated runner before installation');

  const prefix = envPrefixForMcp(identifier);
  const configuredUrl = process.env[`${prefix}_URL`]?.trim();
  const serverUrl = configuredUrl || connection.url?.trim();
  if (!serverUrl) throw new Error('Fab local MCP endpoint is not configured');
  const parsed = new URL(serverUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Fab local MCP endpoint is invalid');
  if (!configuredUrl && parsed.protocol !== 'https:')
    throw new Error('Catalog-provided Fab local MCP endpoints must use HTTPS');

  const token = process.env[`${prefix}_TOKEN`]?.trim();
  const identity = process.env[`${prefix}_IDENTITY`]?.trim();
  if (item.auth === 'server-managed' && !token)
    throw new Error('Fab local MCP server credential is not configured');
  if (item.auth === 'user-config')
    throw new Error('Fab local MCP requires user configuration before installation');

  return { identity, item, serverUrl, token };
};

export const getLocalSkillPackage = async (identifier: string) => {
  const item = (await listLocalSkillCatalog()).find((candidate) => candidate.id === identifier);
  if (!item) throw new Error('Fab local skill package was not found or did not pass the catalog gate');

  const packageUrl = `${catalogBase()}/${item.packagePath}`;
  const response = await fetch(packageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Fab local skill package returned ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PACKAGE_BYTES) throw new Error('Fab local skill package is too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new Error('Fab local skill package is too large');
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== item.sha256) throw new Error('Fab local skill package hash mismatch');

  return {
    buffer,
    item,
    packageUrl: `${publicCatalogBase()}/${item.packagePath}`,
  };
};
