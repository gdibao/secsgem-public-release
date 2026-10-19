import { and, eq } from 'drizzle-orm';

import { loadModels } from '@/business/client/model-bank/loadModels';
import type {
  MobileFeaturedAssistantV1,
  MobileResolvedFeaturedAssistantV1,
} from '@/const/mobileConfig';
import { adminNewapiInstanceModels, adminNewapiInstances } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { DiscoverService } from '@/server/services/discover';

export interface MobileFeaturedModel {
  displayName: string;
  id: string;
  provider: string;
}

export interface MobileFeaturedAssistantsSnapshotKey {
  revision: number;
  updatedAt: string;
}

interface MobileFeaturedAssistantsSnapshotCacheOptions {
  now?: () => number;
  ttlMs?: number;
}

interface MobileAssistantCandidate {
  avatar?: null | string;
  description?: null | string;
  identifier?: null | string;
  status?: null | string;
  title?: null | string;
}

interface ResolveMobileFeaturedAssistantsParams {
  assistants: MobileFeaturedAssistantV1[];
  loadAssistant: (identifier: string) => Promise<MobileAssistantCandidate | undefined>;
  models: MobileFeaturedModel[];
}

const cleanText = (value: null | string | undefined) => value?.trim() || undefined;
const modelKey = (provider: string, id: string) => `${provider}/${id}`;

export const createMobileFeaturedAssistantsSnapshotCache = <T>({
  now = Date.now,
  ttlMs = 60_000,
}: MobileFeaturedAssistantsSnapshotCacheOptions = {}) => {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  const cacheKey = ({ revision, updatedAt }: MobileFeaturedAssistantsSnapshotKey) =>
    `${revision}:${updatedAt}`;

  const getOrLoad = (
    snapshot: MobileFeaturedAssistantsSnapshotKey,
    load: () => Promise<T>,
  ): Promise<T> => {
    const key = cacheKey(snapshot);
    const current = now();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > current) return cached.value;

    const value = load();
    entries.set(key, { expiresAt: current + ttlMs, value });
    void value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });

    return value;
  };

  return { getOrLoad };
};

export const resolveMobileFeaturedAssistants = async ({
  assistants,
  loadAssistant,
  models,
}: ResolveMobileFeaturedAssistantsParams): Promise<MobileResolvedFeaturedAssistantV1[]> => {
  const modelMap = new Map(models.map((model) => [modelKey(model.provider, model.id), model]));
  const seenIdentifiers = new Set<string>();
  const configuredAssistants = [...assistants]
    .sort((left, right) => left.order - right.order)
    .map((configured) => {
      if (seenIdentifiers.has(configured.assistantId)) return;
      seenIdentifiers.add(configured.assistantId);

      const model = modelMap.get(modelKey(configured.provider, configured.model));
      return model ? { configured, model } : undefined;
    })
    .filter((item): item is { configured: MobileFeaturedAssistantV1; model: MobileFeaturedModel } =>
      Boolean(item),
    );

  const resolved = await Promise.all(
    configuredAssistants.map(async ({ configured, model }) => {
      let assistant: MobileAssistantCandidate | undefined;
      try {
        assistant = await loadAssistant(configured.assistantId);
      } catch {
        return;
      }

      if (
        !assistant ||
        assistant.status !== 'published' ||
        assistant.identifier !== configured.assistantId
      ) {
        return;
      }

      const title = cleanText(configured.titleOverride) || cleanText(assistant.title);
      if (!title) return;

      const avatar = cleanText(assistant.avatar);
      return {
        ...(avatar ? { avatar } : {}),
        description:
          cleanText(configured.descriptionOverride) || cleanText(assistant.description) || '',
        identifier: configured.assistantId,
        model: {
          ...model,
          displayName: cleanText(configured.modelLabelOverride) || '推荐',
        },
        title,
      } satisfies MobileResolvedFeaturedAssistantV1;
    }),
  );

  return resolved
    .filter((item): item is MobileResolvedFeaturedAssistantV1 => Boolean(item))
    .slice(0, 4);
};

const loadAvailableMobileModels = async (db: LobeChatDatabase): Promise<MobileFeaturedModel[]> => {
  const [builtinModels, managedModels] = await Promise.all([
    loadModels(),
    db
      .select({
        displayName: adminNewapiInstanceModels.displayName,
        id: adminNewapiInstanceModels.modelId,
        provider: adminNewapiInstances.id,
      })
      .from(adminNewapiInstanceModels)
      .innerJoin(
        adminNewapiInstances,
        eq(adminNewapiInstanceModels.instanceId, adminNewapiInstances.id),
      )
      .where(
        and(
          eq(adminNewapiInstances.enabled, true),
          eq(adminNewapiInstanceModels.enabled, true),
          eq(adminNewapiInstanceModels.modelType, 'chat'),
        ),
      ),
  ]);

  const models: MobileFeaturedModel[] = [];
  const seen = new Set<string>();
  const add = (model: MobileFeaturedModel) => {
    const key = modelKey(model.provider, model.id);
    if (seen.has(key)) return;
    seen.add(key);
    models.push(model);
  };

  for (const model of builtinModels) {
    if (model.type !== 'chat' || !model.providerId || model.enabled === false) continue;
    add({
      displayName: model.displayName || model.id,
      id: model.id,
      provider: model.providerId,
    });
  }

  for (const model of managedModels) {
    add({
      displayName: model.displayName || model.id,
      id: model.id,
      provider: model.provider,
    });
  }

  return models;
};

export const loadMobileFeaturedAssistants = async (
  db: LobeChatDatabase,
  assistants: MobileFeaturedAssistantV1[],
) => {
  if (assistants.length === 0) return [];

  const [models, discoverService] = await Promise.all([
    loadAvailableMobileModels(db),
    Promise.resolve(new DiscoverService()),
  ]);

  return resolveMobileFeaturedAssistants({
    assistants,
    loadAssistant: async (identifier) => {
      const response = await discoverService.getAssistantList({
        includeAgentGroup: false,
        page: 1,
        pageSize: 20,
        q: identifier,
        source: 'new',
      });
      const assistant = response.items.find((item) => item.identifier === identifier);
      if (!assistant) return;

      return {
        avatar: assistant.avatar,
        description: assistant.description,
        identifier: assistant.identifier,
        status: 'published',
        title: assistant.title,
      };
    },
    models,
  });
};

const mobileFeaturedAssistantsSnapshotCache =
  createMobileFeaturedAssistantsSnapshotCache<MobileResolvedFeaturedAssistantV1[]>();

export const loadCachedMobileFeaturedAssistants = (
  db: LobeChatDatabase,
  published: {
    config: { discover: { assistants: MobileFeaturedAssistantV1[] } };
    revision: number;
    updatedAt: string;
  },
) =>
  mobileFeaturedAssistantsSnapshotCache.getOrLoad(
    { revision: published.revision, updatedAt: published.updatedAt },
    () => loadMobileFeaturedAssistants(db, published.config.discover.assistants),
  );
