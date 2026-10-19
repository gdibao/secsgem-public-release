import type {
  MobileBuiltinAppV1,
  MobileDesignToolV1,
  MobileFeaturedAssistantV1,
  MobileNavigationItemV1,
  MobilePublicConfigV1,
} from '@/const/mobileConfig';
import { normalizeMobileConfig, validateMobileInternalPath } from '@/const/mobileConfig';
import { adminCommercialService } from '@/services/adminCommercial';
import { discoverService } from '@/services/discover';

export type SelectOption = {
  label: string;
  value: string;
};

export type ModelOption = SelectOption & {
  model: string;
  provider: string;
};

export type ValidationResult = {
  messages: string[];
  valid: boolean;
};

export type SelectorStatus = {
  error?: string;
  loading: boolean;
};

export type ValidationMessages = {
  builtinPaths: string;
  uniquePaths: string;
};

export const cloneConfig = (config: unknown): MobilePublicConfigV1 => normalizeMobileConfig(config);

export const toFormConfig = (config: unknown): MobilePublicConfigV1 => cloneConfig(config);

export const stringifyConfig = (config: MobilePublicConfigV1) =>
  JSON.stringify(normalizeMobileConfig(config));

export const sortByOrder = <T extends { order: number }>(items: T[]) =>
  [...items].sort((left, right) => left.order - right.order);

export const withReindexedOrder = <T extends { order: number }>(items: T[]) =>
  items.map((item, index) => ({ ...item, order: index + 1 }));

export const moveOrderedItem = <T extends { order: number }>(
  items: T[],
  matches: (item: T) => boolean,
  direction: -1 | 1,
) => {
  const sortedItems = sortByOrder(items);
  const index = sortedItems.findIndex(matches);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= sortedItems.length) return items;

  const nextItems = [...sortedItems];
  [nextItems[index], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[index]];
  return withReindexedOrder(nextItems);
};

export const removeOrderedItem = <T extends { order: number }>(
  items: T[],
  matches: (item: T) => boolean,
) => withReindexedOrder(sortByOrder(items).filter((item) => !matches(item)));

export const moveArrayItem = <T>(items: T[], value: T, direction: -1 | 1) => {
  const index = items.indexOf(value);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return items;

  const nextItems = [...items];
  [nextItems[index], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[index]];
  return nextItems;
};

export const updateNavigationItem = (
  config: MobilePublicConfigV1,
  id: MobileNavigationItemV1['id'],
  patch: Partial<MobileNavigationItemV1>,
): MobilePublicConfigV1 => ({
  ...config,
  navigation: {
    items: sortByOrder(config.navigation.items).map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  },
});

export const updateDesignTool = (
  config: MobilePublicConfigV1,
  id: MobileDesignToolV1['id'],
  patch: Partial<MobileDesignToolV1>,
): MobilePublicConfigV1 => ({
  ...config,
  design: {
    tools: sortByOrder(config.design.tools).map((tool) =>
      tool.id === id ? { ...tool, ...patch } : tool,
    ),
  },
});

export const updateBuiltinApp = (
  config: MobilePublicConfigV1,
  id: string,
  patch: Partial<MobileBuiltinAppV1>,
): MobilePublicConfigV1 => ({
  ...config,
  applications: {
    ...config.applications,
    builtins: sortByOrder(config.applications.builtins).map((app) =>
      app.id === id ? { ...app, ...patch } : app,
    ),
  },
});

export const moveNavigationItem = (
  config: MobilePublicConfigV1,
  id: MobileNavigationItemV1['id'],
  direction: -1 | 1,
) => {
  const items = moveOrderedItem(config.navigation.items, (item) => item.id === id, direction);
  return items === config.navigation.items ? config : { ...config, navigation: { items } };
};

export const validateFormConfig = (
  config: MobilePublicConfigV1,
  messages: ValidationMessages,
): ValidationResult => {
  const visibleTabs = config.navigation.items.filter((item) => item.visible);
  const validationMessages: string[] = [];

  const visiblePaths = visibleTabs.map((item) => item.path);
  const hasUnsafePath = visiblePaths.some((path) => !validateMobileInternalPath(path));
  const hasDuplicatePath = new Set(visiblePaths).size !== visiblePaths.length;
  if (hasUnsafePath || hasDuplicatePath) validationMessages.push(messages.uniquePaths);

  if (config.applications.builtins.some((app) => !validateMobileInternalPath(app.path))) {
    validationMessages.push(messages.builtinPaths);
  }

  return { messages: validationMessages, valid: validationMessages.length === 0 };
};

export const loadAssistantOptions = async (): Promise<SelectOption[]> => {
  const query = {
    includeAgentGroup: false,
    pageSize: 100,
    source: 'new',
  } as const;
  const firstPage = await discoverService.getAssistantList({ ...query, page: 1 });
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, firstPage.totalPages - 1) }, (_, index) =>
      discoverService.getAssistantList({ ...query, page: index + 2 }),
    ),
  );
  const seen = new Set<string>();

  return [firstPage, ...remainingPages]
    .flatMap((response) => response.items ?? [])
    .filter((assistant) => !assistant.status || assistant.status === 'published')
    .map((assistant): SelectOption | undefined => {
      if (!assistant.identifier || seen.has(assistant.identifier)) return;
      seen.add(assistant.identifier);
      return {
        label: assistant.title || assistant.identifier,
        value: assistant.identifier,
      };
    })
    .filter((option): option is SelectOption => Boolean(option));
};

const collectModelEntries = (value: unknown): any[] => {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct =
    record.enabledModels ??
    record.models ??
    record.items ??
    (Array.isArray(record.catalog) ? record.catalog : (record.catalog as any)?.models);
  if (Array.isArray(direct)) return direct;
  return [];
};

export const loadModelOptions = async (): Promise<ModelOption[]> => {
  const diagnostics = await adminCommercialService.getAiProviderModelCatalogDiagnostics();
  const seen = new Set<string>();

  return collectModelEntries(diagnostics)
    .map((entry): ModelOption | undefined => {
      if (entry.visible === false) return;
      const modelEntry = entry.model && typeof entry.model === 'object' ? entry.model : entry;
      const provider = String(
        entry.provider ??
          entry.providerId ??
          entry.instanceId ??
          modelEntry.providerId ??
          modelEntry.instanceId ??
          '',
      ).trim();
      const model = String(modelEntry.modelId ?? modelEntry.id ?? '').trim();
      if (!provider || !model) return;
      const value = `${provider}/${model}`;
      if (seen.has(value)) return;
      seen.add(value);

      return {
        label: String(modelEntry.displayName ?? modelEntry.name ?? model),
        model,
        provider,
        value,
      };
    })
    .filter((option): option is ModelOption => Boolean(option));
};

export const loadModuleAppOptions = async (): Promise<SelectOption[]> => {
  const items: any[] = [];
  const seenCursors = new Set<string>();
  let cursor: number | string | undefined;

  while (true) {
    const response = await adminCommercialService.moduleApps.list({
      ...(cursor === undefined ? {} : { cursor }),
      limit: 200,
      status: 'published',
    });
    if (Array.isArray((response as any)?.items)) items.push(...(response as any).items);

    const nextCursor = (response as any)?.nextCursor as number | string | null | undefined;
    if (nextCursor === null || nextCursor === undefined) break;
    const cursorKey = String(nextCursor);
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    cursor = nextCursor;
  }

  const seenIds = new Set<string>();

  return items
    .map((app: any): SelectOption | undefined => {
      const value = String(app.appId ?? app.id ?? '').trim();
      if (!value || seenIds.has(value)) return;
      seenIds.add(value);
      return {
        label: String(app.displayName ?? app.name ?? app.title ?? value),
        value,
      };
    })
    .filter((option): option is SelectOption => Boolean(option));
};

export const createMobileSettingsAsyncGuard = () => {
  let draftRevision = 0;
  let mounted = false;
  let saveInFlight = false;

  return {
    beginSave: () => {
      if (!mounted || saveInFlight) return;
      saveInFlight = true;
      return draftRevision;
    },
    finishSave: () => {
      saveInFlight = false;
    },
    isCurrent: (submittedRevision: number) => mounted && draftRevision === submittedRevision,
    isMounted: () => mounted,
    markDraftChanged: () => {
      draftRevision += 1;
    },
    mount: () => {
      mounted = true;
    },
    unmount: () => {
      mounted = false;
    },
  };
};

export const idleSelectorStatus: SelectorStatus = { loading: false };

export type { MobileFeaturedAssistantV1 };
