import { z } from 'zod';

import { ENGINEERING_TOOL_DESTINATIONS } from '@/const/engineeringToolDestination';
import { isMobileConfigurableDestination } from '@/features/MobileWorkspace/destinationRegistry';

export type MobileIconName = string;

export interface MobileNavigationItemV1 {
  icon: MobileIconName;
  id: 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4';
  label: string;
  order: number;
  path: string;
  visible: boolean;
}

export interface MobileDesignToolV1 {
  enabled: boolean;
  icon: MobileIconName;
  id: 'document' | 'image' | 'ppt';
  label: string;
  order: number;
}

export interface MobileFeaturedAssistantV1 {
  assistantId: string;
  descriptionOverride?: string;
  model: string;
  modelLabelOverride?: string;
  order: number;
  provider: string;
  titleOverride?: string;
}

export interface MobileDiscoverCommunityV1 {
  enabled: boolean;
  title: string;
}

export interface MobileResolvedFeaturedAssistantV1 {
  avatar?: string;
  description: string;
  identifier: string;
  model: {
    displayName: string;
    id: string;
    provider: string;
  };
  title: string;
}

export interface MobileBuiltinAppV1 {
  enabled: boolean;
  icon: MobileIconName;
  id: string;
  label: string;
  order: number;
  path: string;
}

export interface MobilePublicConfigV1 {
  applications: {
    builtins: MobileBuiltinAppV1[];
    featuredModuleAppIds: string[];
  };
  brand: { displayName: null | string; logoUrl: null | string };
  design: { tools: MobileDesignToolV1[] };
  discover: {
    assistants: MobileFeaturedAssistantV1[];
    community: MobileDiscoverCommunityV1;
    featuredAssistants?: MobileResolvedFeaturedAssistantV1[];
    title: string;
  };
  navigation: { items: MobileNavigationItemV1[] };
  version: 1;
}

export const MOBILE_BUILTIN_APP_REGISTRY = [
  {
    enabled: true,
    icon: 'list-todo',
    id: 'tasks',
    label: '任务',
    order: 1,
    path: '/tasks',
  },
  {
    enabled: true,
    icon: 'library',
    id: 'skills',
    label: 'Skills',
    order: 2,
    path: '/discover/skill',
  },
  {
    enabled: true,
    icon: 'users',
    id: 'community',
    label: '社区',
    order: 3,
    path: '/community',
  },
  {
    enabled: true,
    icon: 'sparkles',
    id: 'membership',
    label: '会员',
    order: 4,
    path: '/settings/plans',
  },
  {
    enabled: true,
    icon: 'coins',
    id: 'credits',
    label: '积分',
    order: 5,
    path: '/settings/credits',
  },
  {
    enabled: true,
    icon: 'chart-no-axes-column-increasing',
    id: 'usage',
    label: '用量',
    order: 6,
    path: '/settings/usage',
  },
  {
    enabled: true,
    icon: 'settings',
    id: 'settings',
    label: '设置',
    order: 7,
    path: '/settings',
  },
] as const satisfies MobileBuiltinAppV1[];

export const MOBILE_ICON_NAMES = [
  'message-square-more',
  'palette',
  'compass',
  'shapes',
  'file-text',
  'image',
  'presentation',
  'list-todo',
  'library',
  'bot',
  'chart-no-axes-column-increasing',
  'coins',
  'boxes',
  'bell',
  'settings',
  'store',
  'sparkles',
  'search',
  'plus',
  'pin',
  'users',
] as const;

export const DEFAULT_MOBILE_CONFIG: MobilePublicConfigV1 = {
  applications: {
    builtins: MOBILE_BUILTIN_APP_REGISTRY.map((item) => ({ ...item })),
    featuredModuleAppIds: [],
  },
  brand: { displayName: null, logoUrl: null },
  design: {
    tools: [
      { enabled: true, icon: 'file-text', id: 'document', label: '文稿', order: 1 },
      { enabled: true, icon: 'image', id: 'image', label: '图片', order: 2 },
      { enabled: true, icon: 'presentation', id: 'ppt', label: 'PPT', order: 3 },
    ],
  },
  discover: {
    assistants: [],
    community: { enabled: true, title: '社区' },
    title: '推荐助手',
  },
  navigation: {
    items: [
      {
        icon: 'message-square-more',
        id: 'slot-1',
        label: '最近',
        order: 1,
        path: '/',
        visible: true,
      },
      {
        icon: 'boxes',
        id: 'slot-2',
        label: '工具',
        order: 2,
        path: ENGINEERING_TOOL_DESTINATIONS.catalog,
        visible: true,
      },
      {
        icon: 'compass',
        id: 'slot-3',
        label: '发现',
        order: 3,
        path: '/discover',
        visible: true,
      },
      { icon: 'shapes', id: 'slot-4', label: '应用', order: 4, path: '/apps', visible: true },
    ],
  },
  version: 1,
};

const cloneDefaultMobileConfig = (): MobilePublicConfigV1 => ({
  ...DEFAULT_MOBILE_CONFIG,
  applications: {
    builtins: DEFAULT_MOBILE_CONFIG.applications.builtins.map((item) => ({ ...item })),
    featuredModuleAppIds: [...DEFAULT_MOBILE_CONFIG.applications.featuredModuleAppIds],
  },
  brand: { ...DEFAULT_MOBILE_CONFIG.brand },
  design: { tools: DEFAULT_MOBILE_CONFIG.design.tools.map((tool) => ({ ...tool })) },
  discover: {
    ...DEFAULT_MOBILE_CONFIG.discover,
    assistants: [],
    community: { ...DEFAULT_MOBILE_CONFIG.discover.community },
  },
  navigation: { items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item) => ({ ...item })) },
});

const MOBILE_PATH_ORIGIN = 'https://mobile-config.invalid';
const CONTROL_CHARACTER_RE = /\p{Cc}/u;
const ALL_HAN_RE = /^\p{Script=Han}+$/u;
const CATALOG_IDENTIFIER_RE = /^[a-z0-9][\w.:/@+-]{0,127}$/i;
const MAX_IDENTIFIER_LENGTH = 128;
const MOBILE_CONFIG_V1_SCHEMA = z.object({ version: z.literal(1) }).passthrough();

type MobileNavigationId = MobileNavigationItemV1['id'];
type MobileDesignToolId = MobileDesignToolV1['id'];
type OrderedInput<T> = { item: T; order: number; sourceIndex: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeTrimmedString = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return;

  const normalized = value.trim();
  if (normalized.length === 0 || [...normalized].length > maxLength) return;

  return normalized;
};

const normalizeIdentifier = (value: unknown) =>
  normalizeTrimmedString(value, MAX_IDENTIFIER_LENGTH);

const normalizeCatalogIdentifier = (value: unknown) => {
  if (typeof value !== 'string') return;

  const normalized = value.trim();

  return CATALOG_IDENTIFIER_RE.test(normalized) ? normalized : undefined;
};

const normalizeLabel = (value: unknown, fallback: string) => {
  const normalized = normalizeTrimmedString(value, ALL_HAN_RE.test(String(value).trim()) ? 6 : 12);

  return normalized ?? fallback;
};

const normalizeOptionalLabel = (value: unknown) =>
  normalizeTrimmedString(value, ALL_HAN_RE.test(String(value).trim()) ? 6 : 12);

const normalizeIcon = (value: unknown, fallback?: MobileIconName) => {
  const normalized = normalizeTrimmedString(value, 64);

  if (normalized && MOBILE_ICON_NAMES.includes(normalized as (typeof MOBILE_ICON_NAMES)[number])) {
    return normalized;
  }

  return fallback;
};

const normalizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const normalizeOrder = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;

const compareOrderedInputs = <T>(left: OrderedInput<T>, right: OrderedInput<T>) =>
  left.order - right.order || left.sourceIndex - right.sourceIndex;

const reindex = <T extends { order: number }>(items: OrderedInput<T>[]): T[] =>
  [...items]
    .sort(compareOrderedInputs)
    .map(({ item }, index) => ({ ...item, order: index + 1 }) as T);

export const validateMobileInternalPath = (value: unknown) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value.trim() !== value || !value.startsWith('/') || value.startsWith('//')) return false;
  if (value.includes('\\') || CONTROL_CHARACTER_RE.test(value)) return false;

  try {
    const url = new URL(value, MOBILE_PATH_ORIGIN);
    const decodedPathname = decodeURIComponent(url.pathname);

    return (
      url.origin === MOBILE_PATH_ORIGIN &&
      !decodedPathname.startsWith('//') &&
      !decodedPathname.includes('\\') &&
      !CONTROL_CHARACTER_RE.test(decodedPathname)
    );
  } catch {
    return false;
  }
};

const normalizeLogoUrl = (value: unknown) => {
  const normalized = normalizeTrimmedString(value, 2048);
  if (!normalized) return null;
  if (validateMobileInternalPath(normalized)) return normalized;

  try {
    const url = new URL(normalized);

    return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : null;
  } catch {
    return null;
  }
};

const navigationDefaults = () => cloneDefaultMobileConfig().navigation.items;
const designDefaults = () => cloneDefaultMobileConfig().design.tools;

type NormalizedNavigationEntry = OrderedInput<MobileNavigationItemV1> & {
  usesDefaultPath: boolean;
};

const repairNavigationPathCollisions = (entries: NormalizedNavigationEntry[]) => {
  for (let attempts = 0; attempts < entries.length * entries.length; attempts += 1) {
    const seen = new Map<string, NormalizedNavigationEntry>();
    let repaired = false;

    for (const entry of entries) {
      if (!entry.item.visible) continue;

      const existing = seen.get(entry.item.path);
      if (!existing) {
        seen.set(entry.item.path, entry);
        continue;
      }

      const reset = entry.usesDefaultPath && !existing.usesDefaultPath ? existing : entry;
      const fallback = navigationDefaults().find((item) => item.id === reset.item.id)!;

      reset.item = { ...reset.item, path: fallback.path };
      reset.usesDefaultPath = true;
      repaired = true;
      break;
    }

    if (!repaired) return;
  }
};

const normalizeNavigation = (value: unknown): MobileNavigationItemV1[] => {
  const defaults = navigationDefaults();
  const rawItems = isRecord(value) && Array.isArray(value.items) ? value.items : [];
  const entriesById = new Map<
    MobileNavigationId,
    { item: Record<string, unknown>; sourceIndex: number }
  >();

  rawItems.forEach((rawItem, sourceIndex) => {
    if (!isRecord(rawItem)) return;

    const id = rawItem.id;
    if (
      (id === 'slot-1' || id === 'slot-2' || id === 'slot-3' || id === 'slot-4') &&
      !entriesById.has(id)
    ) {
      entriesById.set(id, { item: rawItem, sourceIndex });
    }
  });

  const entries: NormalizedNavigationEntry[] = defaults.map((fallback, defaultIndex) => {
    const raw = entriesById.get(fallback.id);
    if (!raw) {
      return {
        item: { ...fallback },
        order: fallback.order,
        sourceIndex: defaultIndex,
        usesDefaultPath: true,
      };
    }

    const legacyDesignDefault =
      fallback.id === 'slot-2' &&
      raw.item.path === '/design' &&
      raw.item.label === '设计' &&
      raw.item.icon === 'palette';
    const path = legacyDesignDefault
      ? fallback.path
      : typeof raw.item.path === 'string' &&
          validateMobileInternalPath(raw.item.path) &&
          isMobileConfigurableDestination(raw.item.path)
        ? raw.item.path
        : fallback.path;

    return {
      item: {
        icon: legacyDesignDefault ? fallback.icon : normalizeIcon(raw.item.icon, fallback.icon)!,
        id: fallback.id,
        label: legacyDesignDefault ? fallback.label : normalizeLabel(raw.item.label, fallback.label),
        order: 0,
        path,
        // The four primary slots are part of the mobile information architecture.
        // Keep the field for backward-compatible persisted configs, but do not
        // allow an old hidden flag to remove a primary destination.
        visible: true,
      },
      order: normalizeOrder(raw.item.order, fallback.order),
      sourceIndex: raw.sourceIndex,
      usesDefaultPath: path === fallback.path,
    };
  });

  repairNavigationPathCollisions(entries);

  if (entries.filter((entry) => entry.item.visible).length < 2) {
    for (const entry of entries) {
      if (entries.filter((candidate) => candidate.item.visible).length >= 2) break;
      entry.item.visible = true;
    }
    repairNavigationPathCollisions(entries);
  }

  return reindex(entries);
};

const normalizeDesignTools = (value: unknown): MobileDesignToolV1[] => {
  const defaults = designDefaults();
  const rawTools = isRecord(value) && Array.isArray(value.tools) ? value.tools : [];
  const toolsById = new Map<
    MobileDesignToolId,
    { item: Record<string, unknown>; sourceIndex: number }
  >();

  rawTools.forEach((rawTool, sourceIndex) => {
    if (!isRecord(rawTool)) return;

    const id = rawTool.id;
    if ((id === 'document' || id === 'image' || id === 'ppt') && !toolsById.has(id)) {
      toolsById.set(id, { item: rawTool, sourceIndex });
    }
  });

  return reindex(
    defaults.map((fallback, defaultIndex) => {
      const raw = toolsById.get(fallback.id);
      if (!raw) {
        return {
          item: { ...fallback },
          order: fallback.order,
          sourceIndex: rawTools.length + defaultIndex,
        };
      }

      return {
        item: {
          enabled: normalizeBoolean(raw.item.enabled, fallback.enabled),
          icon: normalizeIcon(raw.item.icon, fallback.icon)!,
          id: fallback.id,
          label: normalizeLabel(raw.item.label, fallback.label),
          order: 0,
        },
        order: normalizeOrder(raw.item.order, fallback.order),
        sourceIndex: raw.sourceIndex,
      };
    }),
  );
};

const normalizeAssistants = (value: unknown): MobileFeaturedAssistantV1[] => {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const entries: OrderedInput<MobileFeaturedAssistantV1>[] = [];

  value.forEach((rawAssistant, sourceIndex) => {
    if (!isRecord(rawAssistant)) return;

    const assistantId = normalizeIdentifier(rawAssistant.assistantId);
    const provider = normalizeCatalogIdentifier(rawAssistant.provider);
    const model = normalizeCatalogIdentifier(rawAssistant.model);
    if (!assistantId || !provider || !model || seenIds.has(assistantId)) return;

    seenIds.add(assistantId);
    const titleOverride = normalizeOptionalLabel(rawAssistant.titleOverride);
    const descriptionOverride = normalizeTrimmedString(rawAssistant.descriptionOverride, 160);
    const modelLabelOverride = normalizeOptionalLabel(rawAssistant.modelLabelOverride);

    entries.push({
      item: {
        assistantId,
        ...(descriptionOverride ? { descriptionOverride } : {}),
        model,
        ...(modelLabelOverride ? { modelLabelOverride } : {}),
        order: 0,
        provider,
        ...(titleOverride ? { titleOverride } : {}),
      },
      order: normalizeOrder(rawAssistant.order, sourceIndex + 1),
      sourceIndex,
    });
  });

  return reindex(entries)
    .slice(0, 4)
    .map((assistant, index) => ({ ...assistant, order: index + 1 }));
};

const normalizeResolvedAssistants = (
  value: unknown,
): MobileResolvedFeaturedAssistantV1[] | undefined => {
  if (!Array.isArray(value)) return;

  const seenIds = new Set<string>();
  const assistants: MobileResolvedFeaturedAssistantV1[] = [];

  for (const rawAssistant of value) {
    if (!isRecord(rawAssistant)) continue;

    const identifier = normalizeIdentifier(rawAssistant.identifier);
    const title = normalizeTrimmedString(rawAssistant.title, 80);
    const description = normalizeTrimmedString(rawAssistant.description, 160) ?? '';
    const avatar = normalizeTrimmedString(rawAssistant.avatar, 2048);
    const model = isRecord(rawAssistant.model) ? rawAssistant.model : {};
    const modelId = normalizeCatalogIdentifier(model.id);
    const provider = normalizeCatalogIdentifier(model.provider);
    const displayName = normalizeTrimmedString(model.displayName, 80);

    if (!identifier || !title || !modelId || !provider || !displayName || seenIds.has(identifier)) {
      continue;
    }

    seenIds.add(identifier);
    assistants.push({
      ...(avatar ? { avatar } : {}),
      description,
      identifier,
      model: { displayName, id: modelId, provider },
      title,
    });

    if (assistants.length === 4) break;
  }

  return assistants;
};

export const normalizeMobileBuiltinApps = (value: unknown): MobileBuiltinAppV1[] => {
  const rawById = new Map<string, Record<string, unknown>>();

  if (Array.isArray(value)) {
    for (const rawBuiltin of value) {
      if (!isRecord(rawBuiltin)) continue;

      const id = normalizeIdentifier(rawBuiltin.id);
      if (!id || rawById.has(id) || !MOBILE_BUILTIN_APP_REGISTRY.some((item) => item.id === id)) {
        continue;
      }

      rawById.set(id, rawBuiltin);
    }
  }

  return reindex(
    MOBILE_BUILTIN_APP_REGISTRY.map((fallback, sourceIndex) => {
      const raw = rawById.get(fallback.id);
      const path = raw?.path;

      return {
        item: {
          enabled: normalizeBoolean(raw?.enabled, fallback.enabled),
          icon: normalizeIcon(raw?.icon, fallback.icon) ?? fallback.icon,
          id: fallback.id,
          label: normalizeLabel(raw?.label, fallback.label),
          order: 0,
          path:
            typeof path === 'string' &&
            validateMobileInternalPath(path) &&
            isMobileConfigurableDestination(path)
              ? path
              : fallback.path,
        },
        order: normalizeOrder(raw?.order, fallback.order),
        sourceIndex,
      };
    }),
  );
};

const normalizeFeaturedModuleAppIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(normalizeIdentifier).filter((id): id is string => Boolean(id)))];
};

export const normalizeMobileConfig = (input: unknown): MobilePublicConfigV1 => {
  const parsed = MOBILE_CONFIG_V1_SCHEMA.safeParse(input);
  if (!parsed.success) return cloneDefaultMobileConfig();

  const config = parsed.data;
  const applications = isRecord(config.applications) ? config.applications : {};
  const brand = isRecord(config.brand) ? config.brand : {};
  const discover = isRecord(config.discover) ? config.discover : {};
  const community = isRecord(discover.community) ? discover.community : {};
  const featuredAssistants = normalizeResolvedAssistants(discover.featuredAssistants);

  return {
    applications: {
      builtins: normalizeMobileBuiltinApps(applications.builtins),
      featuredModuleAppIds: normalizeFeaturedModuleAppIds(applications.featuredModuleAppIds),
    },
    brand: {
      displayName: normalizeOptionalLabel(brand.displayName) ?? null,
      logoUrl: normalizeLogoUrl(brand.logoUrl),
    },
    design: { tools: normalizeDesignTools(config.design) },
    discover: {
      assistants: normalizeAssistants(discover.assistants),
      community: {
        enabled: normalizeBoolean(
          community.enabled,
          DEFAULT_MOBILE_CONFIG.discover.community.enabled,
        ),
        title: normalizeLabel(community.title, DEFAULT_MOBILE_CONFIG.discover.community.title),
      },
      ...(featuredAssistants ? { featuredAssistants } : {}),
      title: normalizeTrimmedString(discover.title, 12) ?? DEFAULT_MOBILE_CONFIG.discover.title,
    },
    navigation: { items: normalizeNavigation(config.navigation) },
    version: 1,
  };
};
