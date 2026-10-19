import { LobeHubPath, OFFICIAL_URL } from '@lobechat/const/url';
import type { ModelRating } from 'model-bank';
import { z } from 'zod';

import type {
  LobeHubModelCatalogPayload,
  LobeHubModelDisplayCard,
  LobeHubModelRatingsPayload,
} from '@/types/lobeHubModelCatalog';

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

const MODEL_CONFIG_URL = new URL(LobeHubPath.webapi.modelConfig, OFFICIAL_URL).toString();
const MODEL_RATINGS_URL = new URL(LobeHubPath.webapi.modelRatings, OFFICIAL_URL).toString();

const modelIdSchema = z.string().trim().min(1).max(256);
const optionalTextSchema = z.string().trim().min(1).max(2000).optional();
const abilitiesSchema = z
  .object({
    audio: z.boolean().optional(),
    files: z.boolean().optional(),
    functionCall: z.boolean().optional(),
    imageOutput: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    search: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    video: z.boolean().optional(),
    vision: z.boolean().optional(),
  })
  .optional();
const modelDisplaySchema = z.object({
  abilities: abilitiesSchema,
  contextWindowTokens: z.number().int().nonnegative().optional(),
  description: optionalTextSchema,
  displayName: z.string().trim().min(1).max(256).optional(),
  family: z.string().trim().min(1).max(128).optional(),
  generation: z.string().trim().min(1).max(128).optional(),
  id: modelIdSchema,
  knowledgeCutoff: z.string().trim().min(1).max(32).optional(),
  releasedAt: z.string().trim().min(1).max(64).optional(),
});
const rawModelCatalogSchema = z.object({
  models: z.array(z.unknown()).max(2000),
  proModels: z.array(z.unknown()).max(2000),
  updatedAt: z.string().max(128).optional(),
  version: z.number().int().nonnegative().optional(),
});

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Expected an HTTPS URL');
const benchmarkScoreSchema = z.object({
  raw: z.number().finite().optional(),
  score: z.number().finite().min(0).max(100),
  source: z.enum(['artificial-analysis', 'design-arena', 'lmarena', 'lobehub']),
  sourceUrl: httpsUrlSchema,
  updatedAt: z.string().trim().min(1).max(64),
});
const modelRatingSchema = z.object({
  agentic: benchmarkScoreSchema.optional(),
  design: benchmarkScoreSchema.optional(),
  intelligence: benchmarkScoreSchema.optional(),
  price: benchmarkScoreSchema.optional(),
  speed: benchmarkScoreSchema.optional(),
  writing: benchmarkScoreSchema.optional(),
});
const rawModelRatingsSchema = z.object({
  fetchedAt: z.string().max(128).optional(),
  ratings: z.record(z.string(), z.unknown()),
});

interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

let cachedCatalog: CacheEntry<LobeHubModelCatalogPayload> | undefined;
let cachedRatings: CacheEntry<LobeHubModelRatingsPayload> | undefined;
let pendingCatalogRequest: Promise<LobeHubModelCatalogPayload> | undefined;
let pendingRatingsRequest: Promise<LobeHubModelRatingsPayload> | undefined;

const fetchJson = async (url: string, headers?: HeadersInit) => {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`LobeHub display metadata returned HTTP ${response.status}`);

  return response.json();
};

const fetchModelCatalog = async (): Promise<LobeHubModelCatalogPayload> => {
  const parsed = rawModelCatalogSchema.safeParse(
    await fetchJson(MODEL_CONFIG_URL, { 'x-lobehub-model-config-client-filter': '1' }),
  );
  if (!parsed.success) throw new Error('LobeHub model config returned an invalid payload');

  const models = parsed.data.models.flatMap<LobeHubModelDisplayCard>((rawModel) => {
    const model = modelDisplaySchema.safeParse(rawModel);
    return model.success ? [model.data] : [];
  });
  const proModels = parsed.data.proModels.flatMap<string>((rawModelId) => {
    const modelId = modelIdSchema.safeParse(rawModelId);
    return modelId.success ? [modelId.data] : [];
  });

  if (models.length === 0) throw new Error('LobeHub model config contained no usable models');

  return {
    models,
    proModels,
    updatedAt: parsed.data.updatedAt,
    version: parsed.data.version,
  };
};

const fetchModelRatings = async (): Promise<LobeHubModelRatingsPayload> => {
  const parsed = rawModelRatingsSchema.safeParse(await fetchJson(MODEL_RATINGS_URL));
  if (!parsed.success) throw new Error('LobeHub model ratings returned an invalid payload');

  const ratings = Object.entries(parsed.data.ratings).reduce<Record<string, ModelRating>>(
    (result, [modelId, rawRating]) => {
      const parsedModelId = modelIdSchema.safeParse(modelId);
      const rating = modelRatingSchema.safeParse(rawRating);
      if (parsedModelId.success && rating.success) result[parsedModelId.data] = rating.data;
      return result;
    },
    {},
  );

  if (Object.keys(ratings).length === 0) {
    throw new Error('LobeHub model ratings contained no usable entries');
  }

  return { fetchedAt: parsed.data.fetchedAt, ratings };
};

const loadWithCache = async <T>({
  cache,
  fetcher,
  pending,
  setCache,
  setPending,
}: {
  cache: CacheEntry<T> | undefined;
  fetcher: () => Promise<T>;
  pending: Promise<T> | undefined;
  setCache: (value: CacheEntry<T>) => void;
  setPending: (value: Promise<T> | undefined) => void;
}): Promise<T | undefined> => {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.value;

  const request =
    pending ??
    fetcher().finally(() => {
      setPending(undefined);
    });
  if (!pending) {
    setPending(request);
  }

  try {
    const value = await request;
    setCache({ fetchedAt: Date.now(), value });
    return value;
  } catch {
    return cache && now - cache.fetchedAt < MAX_STALE_AGE_MS ? cache.value : undefined;
  }
};

export const getLobeHubModelCatalog = async () =>
  loadWithCache({
    cache: cachedCatalog,
    fetcher: fetchModelCatalog,
    pending: pendingCatalogRequest,
    setCache: (value) => {
      cachedCatalog = value;
    },
    setPending: (value) => {
      pendingCatalogRequest = value;
    },
  });

export const getLobeHubModelRatings = async () =>
  loadWithCache({
    cache: cachedRatings,
    fetcher: fetchModelRatings,
    pending: pendingRatingsRequest,
    setCache: (value) => {
      cachedRatings = value;
    },
    setPending: (value) => {
      pendingRatingsRequest = value;
    },
  });

export const invalidateLobeHubModelCatalogCache = () => {
  cachedCatalog = undefined;
  cachedRatings = undefined;
  pendingCatalogRequest = undefined;
  pendingRatingsRequest = undefined;
};
