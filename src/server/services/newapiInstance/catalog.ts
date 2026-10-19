import {
  LOBE_DEFAULT_MODEL_LIST,
  type ModelAbilities,
  type Pricing,
  type PricingUnit,
  type PricingUnitName,
} from 'model-bank';
import urlJoin from 'url-join';

import type { NewapiModelType } from './index';

export type AdminModelApiProviderType =
  | 'newapi'
  | 'sub2api'
  | 'openai-compatible'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'aliyun'
  | 'opencode-go'
  | 'siliconflow';

export interface NewapiRemoteModel {
  abilities?: Record<string, unknown>;
  capabilities?: Record<string, unknown> | string[];
  created?: number;
  id: string;
  object?: string;
  owned_by?: string;
  supported_endpoint_types?: Array<number | string>;
  tags?: string | string[];
  type?: string;
}

export interface NewapiRemotePricing {
  abilities?: Record<string, unknown>;
  audio_completion_ratio?: number;
  audio_ratio?: number;
  cache_ratio?: number;
  capabilities?: Record<string, unknown> | string[];
  completion_ratio?: number;
  create_cache_ratio?: number;
  description?: string;
  enable_groups?: string[];
  function_tags?: string;
  image_ratio?: number;
  model_name: string;
  model_price?: number;
  model_ratio?: number;
  quota_type?: number;
  resolvedPricing?: Pricing;
  supported_endpoint_types?: Array<number | string>;
  tags?: string | string[];
}

export interface NormalizedNewapiSyncRow {
  displayName?: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  modelId: string;
  modelType: NewapiModelType;
  sortOrder: number;
}

export type NewapiPricingSyncStatus =
  'available' | 'disabled' | 'unavailable' | 'unsafe' | 'unsupported';

export interface NewapiPricingFetchResult {
  items: NewapiRemotePricing[];
  status: NewapiPricingSyncStatus;
  warnings?: string[];
}

const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const endpointIncludes = (values: string[], terms: string[]) =>
  values.some((value) => terms.some((term) => value.includes(term)));

const idIncludes = (id: string, terms: string[]) => terms.some((term) => id.includes(term));

const normalizeNewapiRoot = (baseUrl: string) =>
  baseUrl.replace(/\/+$/, '').replace(/\/v\d+[a-z]*\/?$/, '');

const normalizeNewapiApiBase = (baseUrl: string) => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+[a-z]*$/i.test(trimmed) ? trimmed : urlJoin(trimmed, '/v1');
};

export const supportsNewapiPricingSync = (
  providerType?: AdminModelApiProviderType | string | null,
) => !providerType || providerType === 'newapi' || providerType === 'sub2api';

export const buildNewapiPricingSyncWarnings = (
  providerType: AdminModelApiProviderType | string | null | undefined,
  pricingCount: number,
  status: NewapiPricingSyncStatus = 'available',
) => {
  if (!supportsNewapiPricingSync(providerType)) {
    return [
      `Pricing sync is not supported for provider type ${providerType}. Configure manual pricing in the model billing matrix.`,
    ];
  }

  if (status === 'disabled') {
    return ['Upstream pricing sync is disabled for this instance'];
  }

  if (status === 'unavailable') {
    return ['Pricing endpoint unavailable; existing pricing metadata was preserved'];
  }

  if (status === 'unsafe') {
    return ['Upstream prices that could not be represented safely were cleared'];
  }

  return pricingCount === 0 ? ['Pricing endpoint returned no entries'] : [];
};

const isClaudeApiProvider = (providerType?: AdminModelApiProviderType | string | null) =>
  providerType === 'claude';

const buildModelListHeaders = ({
  apiKey,
  providerType,
}: {
  apiKey: string;
  providerType?: AdminModelApiProviderType | string | null;
}): Record<string, string> => {
  if (isClaudeApiProvider(providerType)) {
    return {
      'Accept': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    };
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
};

export const classifyNewapiModelType = (
  model: Pick<NewapiRemoteModel, 'id' | 'supported_endpoint_types' | 'type'>,
  pricing?: Pick<NewapiRemotePricing, 'supported_endpoint_types'>,
): NewapiModelType => {
  const endpoints = [
    ...(model.supported_endpoint_types ?? []),
    ...(pricing?.supported_endpoint_types ?? []),
  ]
    .map((item) => String(item).toLowerCase().trim())
    .filter(Boolean);
  const explicitType = model.type?.toLowerCase().trim();
  const id = model.id.toLowerCase();
  const isKnownAsrModel = idIncludes(id, ['sensevoice', 'telespeechasr']);

  if (isKnownAsrModel) return 'asr';

  if (
    explicitType === 'tts' ||
    endpointIncludes(endpoints, ['audio-speech', 'audio_speech', 'text-to-speech', 'tts'])
  ) {
    return 'tts';
  }

  if (
    explicitType === 'asr' ||
    explicitType === 'stt' ||
    endpointIncludes(endpoints, [
      'asr',
      'audio-transcription',
      'audio_transcription',
      'speech-to-text',
      'stt',
      'transcription',
    ])
  ) {
    return 'asr';
  }

  if (explicitType === 'realtime' || endpointIncludes(endpoints, ['realtime'])) {
    return 'realtime';
  }

  if (
    explicitType === 'text2music' ||
    endpointIncludes(endpoints, ['music-generation', 'music_generation', 'text-to-music'])
  ) {
    return 'text2music';
  }

  if (
    explicitType === 'image' ||
    endpointIncludes(endpoints, ['image', 'images', 'image_generation'])
  ) {
    return 'image';
  }

  if (
    explicitType === 'video' ||
    endpointIncludes(endpoints, ['video', 'videos', 'video_generation'])
  ) {
    return 'video';
  }

  if (explicitType === 'embedding' || endpointIncludes(endpoints, ['embedding', 'embeddings'])) {
    return 'embedding';
  }

  if (
    idIncludes(id, ['image', 'dall-e', 'flux', 'stable-diffusion', 'imagen']) ||
    /\bsd[-_]/.test(id)
  ) {
    return 'image';
  }

  if (idIncludes(id, ['video', 'sora', 'wan', 'hailuo', 'seedance', 'kling', 'veo'])) {
    return 'video';
  }

  if (idIncludes(id, ['embedding', 'embed', 'reranker', 'rerank'])) return 'embedding';

  if (idIncludes(id, ['text-to-speech', '-tts', 'tts-']) || id.endsWith('tts')) return 'tts';
  if (
    idIncludes(id, ['audio-transcription', 'speech-to-text', 'transcribe', 'whisper']) ||
    id.endsWith('-asr') ||
    id.endsWith('-stt')
  )
    return 'asr';
  if (idIncludes(id, ['realtime'])) return 'realtime';
  if (idIncludes(id, ['suno', 'text-to-music'])) return 'text2music';

  return 'chat';
};

const MODEL_ABILITY_KEYS = [
  'vision',
  'files',
  'imageOutput',
  'video',
  'audio',
  'functionCall',
  'reasoning',
  'search',
  'structuredOutput',
] as const satisfies ReadonlyArray<keyof ModelAbilities>;

const ABILITY_TAGS: Record<(typeof MODEL_ABILITY_KEYS)[number], string[]> = {
  audio: ['audio', 'audio input'],
  files: ['document input', 'file input', 'files'],
  functionCall: ['function call', 'function calling', 'tool calling', 'tools'],
  imageOutput: ['image generation', 'image output', 'text to image'],
  reasoning: ['reasoning', 'thinking'],
  search: ['grounding', 'search', 'web search'],
  structuredOutput: ['json mode', 'json schema', 'structured output'],
  video: ['video', 'video generation', 'video input'],
  vision: ['image input', 'multimodal input', 'vision'],
};

const normalizeAbilityName = (value: string) =>
  value
    .trim()
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .toLowerCase();

const readAbilityTags = (...values: unknown[]) =>
  values.flatMap((value): string[] => {
    if (typeof value === 'string') {
      return value.split(/[,;|]/).map(normalizeAbilityName).filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map(normalizeAbilityName)
        .filter(Boolean);
    }
    return [];
  });

const applyExplicitAbilities = (abilities: ModelAbilities, value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const normalizedEntries = new Map(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      normalizeAbilityName(key),
      item,
    ]),
  );
  let applied = false;
  for (const key of MODEL_ABILITY_KEYS) {
    const aliases = [normalizeAbilityName(key), ...ABILITY_TAGS[key]];
    const match = aliases
      .map((alias) => normalizedEntries.get(alias))
      .find((item) => typeof item === 'boolean');
    if (typeof match === 'boolean') {
      abilities[key] = match;
      applied = true;
    }
  }
  return applied;
};

const resolveSyncedModelAbilities = ({
  model,
  modelBankProviderId,
  modelType,
  pricing,
}: {
  model: NewapiRemoteModel;
  modelBankProviderId?: string;
  modelType: NewapiModelType;
  pricing?: NewapiRemotePricing;
}) => {
  const abilities: ModelAbilities = {};
  const sources: string[] = [];
  const exactSystemMatches = LOBE_DEFAULT_MODEL_LIST.filter(
    (item) => item.id === model.id && item.type === modelType,
  );
  const providerMatches = modelBankProviderId
    ? exactSystemMatches.filter((item) => item.providerId === modelBankProviderId)
    : [];
  const systemMatches = providerMatches.length > 0 ? providerMatches : exactSystemMatches;
  for (const item of systemMatches) {
    for (const key of MODEL_ABILITY_KEYS) {
      if (item.abilities?.[key] === true) abilities[key] = true;
    }
  }
  if (Object.keys(abilities).length > 0) sources.push('system-model-bank');

  const upstreamTags = readAbilityTags(
    model.tags,
    Array.isArray(model.capabilities) ? model.capabilities : undefined,
    pricing?.tags,
    Array.isArray(pricing?.capabilities) ? pricing.capabilities : undefined,
    pricing?.function_tags,
    model.supported_endpoint_types,
    pricing?.supported_endpoint_types,
  );
  let hasUpstreamAbilities = [
    model.abilities,
    model.capabilities,
    pricing?.abilities,
    pricing?.capabilities,
  ]
    .map((value) => applyExplicitAbilities(abilities, value))
    .some(Boolean);
  for (const key of MODEL_ABILITY_KEYS) {
    if (ABILITY_TAGS[key].some((tag) => upstreamTags.includes(tag))) {
      abilities[key] = true;
      hasUpstreamAbilities = true;
    }
  }
  if (modelType === 'image') {
    abilities.imageOutput = true;
    hasUpstreamAbilities = true;
  } else if (modelType === 'video') {
    abilities.video = true;
    hasUpstreamAbilities = true;
  }
  if (hasUpstreamAbilities) sources.push('upstream');

  return {
    abilities: Object.keys(abilities).length > 0 ? abilities : undefined,
    sources,
  };
};

export const normalizeNewapiSyncRows = ({
  modelBankProviderId,
  models,
  pricing,
  pricingStatus = 'available',
  syncSource = 'newapi',
}: {
  modelBankProviderId?: string;
  models: NewapiRemoteModel[];
  pricing: NewapiRemotePricing[];
  pricingStatus?: NewapiPricingSyncStatus;
  syncSource?: 'newapi' | 'sub2api';
}): NormalizedNewapiSyncRow[] => {
  const pricingByModel = new Map<string, NewapiRemotePricing>();
  for (const item of pricing) {
    const modelName = item.model_name?.trim();
    if (modelName && !pricingByModel.has(modelName)) pricingByModel.set(modelName, item);
  }

  const uniqueModels = new Map<string, NewapiRemoteModel>();
  for (const model of models) {
    const modelId = model.id?.trim();
    if (modelId && !uniqueModels.has(modelId)) uniqueModels.set(modelId, { ...model, id: modelId });
  }

  const syncedAt = new Date().toISOString();
  return [...uniqueModels.values()].map((model, index) => {
    const pricingItem = pricingByModel.get(model.id);
    const modelType = classifyNewapiModelType(model, pricingItem);

    const metadata: Record<string, unknown> = {
      syncedAt,
      syncSource,
      syncStatus: 'active',
    };

    const assignIfDefined = (key: string, value: unknown) => {
      if (value !== undefined) metadata[key] = value;
    };

    assignIfDefined('created', model.created);
    assignIfDefined('object', model.object);
    assignIfDefined('ownedBy', model.owned_by);

    const supportedEndpointTypes = [
      ...(model.supported_endpoint_types ?? []),
      ...(pricingItem?.supported_endpoint_types ?? []),
    ]
      .map(String)
      .filter((item, itemIndex, items) => item && items.indexOf(item) === itemIndex);
    if (supportedEndpointTypes.length > 0) {
      metadata.supportedEndpointTypes = supportedEndpointTypes;
    }

    const syncedAbilities = resolveSyncedModelAbilities({
      model,
      modelBankProviderId,
      modelType,
      pricing: pricingItem,
    });
    if (syncedAbilities.abilities) metadata.syncedAbilities = syncedAbilities.abilities;
    if (syncedAbilities.sources.length > 0) {
      metadata.syncedAbilitySources = syncedAbilities.sources;
    }

    if (pricingStatus === 'available' || pricingStatus === 'unsafe') {
      for (const key of [
        'audioCompletionRatio',
        'audioRatio',
        'cacheRatio',
        'completionRatio',
        'createCacheRatio',
        'enableGroups',
        'imageRatio',
        'modelPrice',
        'modelRatio',
        'quotaType',
        'syncedPricing',
      ]) {
        delete metadata[key];
      }

      metadata.pricingAvailable = Boolean(pricingItem);
      metadata.pricingSyncStatus = pricingStatus;
      if (pricingItem) {
        metadata.pricingSource = syncSource;
        metadata.pricingSyncedAt = syncedAt;
      }
      assignIfDefined('audioCompletionRatio', pricingItem?.audio_completion_ratio);
      assignIfDefined('audioRatio', pricingItem?.audio_ratio);
      assignIfDefined('cacheRatio', pricingItem?.cache_ratio);
      assignIfDefined('completionRatio', pricingItem?.completion_ratio);
      assignIfDefined('createCacheRatio', pricingItem?.create_cache_ratio);
      assignIfDefined('enableGroups', pricingItem?.enable_groups);
      assignIfDefined('imageRatio', pricingItem?.image_ratio);
      assignIfDefined('modelPrice', pricingItem?.model_price);
      assignIfDefined('modelRatio', pricingItem?.model_ratio);
      assignIfDefined('quotaType', pricingItem?.quota_type);
      assignIfDefined('syncedPricing', pricingItem?.resolvedPricing);
    } else {
      metadata.pricingSyncStatus = pricingStatus;
    }

    return {
      displayName: pricingItem?.description,
      enabled: false,
      metadata,
      modelId: model.id,
      modelType,
      sortOrder: index,
    };
  });
};

const fetchWithTimeout = async <T>(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} request timed out after ${timeoutMs}ms`, { cause: error });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const readBoundedJson = async (
  response: Response,
  label: string,
  maxBodyBytes: number,
): Promise<unknown> => {
  const contentLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new Error(`${label} response exceeded the ${maxBodyBytes} byte limit`);
  }

  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let bodyBytes = 0;
    let text = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          text += decoder.decode();
          break;
        }

        const chunk = value as Uint8Array;
        bodyBytes += chunk.byteLength;
        if (bodyBytes > maxBodyBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`${label} response exceeded the ${maxBodyBytes} byte limit`);
        }
        text += decoder.decode(chunk, { stream: true });
      }

      return JSON.parse(text);
    } finally {
      reader.releaseLock?.();
    }
  }

  if (typeof response.text === 'function') {
    const text = await response.text();
    const bodyBytes = new TextEncoder().encode(text).byteLength;
    if (bodyBytes > maxBodyBytes) {
      throw new Error(`${label} response exceeded the ${maxBodyBytes} byte limit`);
    }

    return JSON.parse(text);
  }

  return response.json();
};

interface Sub2apiPricingInterval {
  cache_read_price?: number | null;
  cache_write_price?: number | null;
  input_price?: number | null;
  max_tokens?: number | null;
  min_tokens?: number;
  output_price?: number | null;
  per_request_price?: number | null;
}

interface Sub2apiModelPricing {
  billing_mode?: string;
  cache_read_price?: number | null;
  cache_write_price?: number | null;
  image_input_price?: number | null;
  image_output_price?: number | null;
  input_price?: number | null;
  intervals?: Sub2apiPricingInterval[];
  output_price?: number | null;
  per_request_price?: number | null;
}

interface Sub2apiModelPlazaGroup {
  image_rate_independent?: boolean;
  image_rate_multiplier?: number;
  models?: Array<{
    name?: string;
    platform?: string;
    pricing?: Sub2apiModelPricing | null;
  }>;
  rate_multiplier?: number;
}

interface Sub2apiBillingInfo {
  billing_scope?: string;
  group_rate_multiplier?: number;
  object?: string;
  peak_rate_enabled?: boolean;
  resolved_rate_multiplier?: number;
}

const toNonNegativeNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const scaleSub2apiTokenRate = (value: unknown, multiplier: number) => {
  const number = toNonNegativeNumber(value);
  return number === undefined ? undefined : number * multiplier * 1_000_000;
};

const buildSub2apiTokenUnit = ({
  baseRate,
  intervalKey,
  intervals,
  multiplier,
  name,
}: {
  baseRate: unknown;
  intervalKey: keyof Sub2apiPricingInterval;
  intervals: Sub2apiPricingInterval[];
  multiplier: number;
  name: PricingUnitName;
}): { invalid: boolean; unit?: PricingUnit } => {
  const intervalRates = intervals.map((interval) =>
    scaleSub2apiTokenRate(interval[intervalKey], multiplier),
  );
  const hasIntervalRates = intervalRates.some((rate) => rate !== undefined);

  if (hasIntervalRates) {
    return { invalid: true };
  }

  const rate = scaleSub2apiTokenRate(baseRate, multiplier);
  return rate === undefined
    ? { invalid: false }
    : {
        invalid: false,
        unit: { name, rate, strategy: 'fixed', unit: 'millionTokens' },
      };
};

const resolveSub2apiModelPricing = ({
  imageMultiplier,
  modelId,
  pricing,
  tokenMultiplier,
}: {
  imageMultiplier: number;
  modelId: string;
  pricing: Sub2apiModelPricing;
  tokenMultiplier: number;
}): Pricing | undefined => {
  const billingMode = (pricing.billing_mode || 'token').toLowerCase();
  const intervals = Array.isArray(pricing.intervals) ? pricing.intervals : [];

  if (billingMode === 'token') {
    const unitSpecs: Array<{
      baseRate: unknown;
      intervalKey: keyof Sub2apiPricingInterval;
      name: PricingUnitName;
    }> = [
      { baseRate: pricing.input_price, intervalKey: 'input_price', name: 'textInput' },
      { baseRate: pricing.output_price, intervalKey: 'output_price', name: 'textOutput' },
      {
        baseRate: pricing.cache_read_price,
        intervalKey: 'cache_read_price',
        name: 'textInput_cacheRead',
      },
      {
        baseRate: pricing.cache_write_price,
        intervalKey: 'cache_write_price',
        name: 'textInput_cacheWrite',
      },
      { baseRate: pricing.image_input_price, intervalKey: 'input_price', name: 'imageInput' },
      { baseRate: pricing.image_output_price, intervalKey: 'output_price', name: 'imageOutput' },
    ];
    const units: PricingUnit[] = [];

    for (const spec of unitSpecs) {
      const result = buildSub2apiTokenUnit({
        ...spec,
        intervals: spec.name === 'imageInput' || spec.name === 'imageOutput' ? [] : intervals,
        multiplier: tokenMultiplier,
      });
      if (result.invalid) return undefined;
      if (result.unit) units.push(result.unit);
    }

    return units.length > 0 ? { units } : undefined;
  }

  if (billingMode !== 'image' && billingMode !== 'per_request') return undefined;
  if (intervals.length > 0) return undefined;

  const perRequestPrice = toNonNegativeNumber(pricing.per_request_price);
  if (perRequestPrice === undefined) return undefined;
  const modelType = classifyNewapiModelType({
    id: modelId,
    supported_endpoint_types: billingMode === 'image' ? ['image_generation'] : undefined,
  });
  const rate = perRequestPrice * imageMultiplier;

  if (modelType === 'image') {
    return {
      approximatePricePerImage: rate,
      units: [{ name: 'imageGeneration', rate, strategy: 'fixed', unit: 'image' }],
    };
  }

  return undefined;
};

const sameRate = (left: unknown, right: unknown) => {
  const leftNumber = toNonNegativeNumber(left);
  const rightNumber = toNonNegativeNumber(right);
  if (leftNumber === undefined || rightNumber === undefined) return false;
  return Math.abs(leftNumber - rightNumber) <= 1e-9;
};

const fetchSub2apiPricing = async ({
  apiKey,
  baseUrl,
  maxBodyBytes,
  timeoutMs,
}: {
  apiKey: string;
  baseUrl: string;
  maxBodyBytes: number;
  timeoutMs: number;
}): Promise<NewapiPricingFetchResult> => {
  try {
    const billingHeaders = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
    const [billing, plazaGroups] = await Promise.all([
      fetchWithTimeout(
        urlJoin(normalizeNewapiApiBase(baseUrl), '/sub2api/billing'),
        { headers: billingHeaders },
        'Sub2API billing',
        timeoutMs,
        async (response): Promise<Sub2apiBillingInfo> => {
          if (!response.ok) throw new Error(`Sub2API billing request failed: ${response.status}`);
          return (await readBoundedJson(
            response,
            'Sub2API billing',
            maxBodyBytes,
          )) as Sub2apiBillingInfo;
        },
      ),
      fetchWithTimeout(
        urlJoin(normalizeNewapiRoot(baseUrl), '/api/v1/model-plaza'),
        { headers: { Accept: 'application/json' } },
        'Sub2API model plaza',
        timeoutMs,
        async (response): Promise<Sub2apiModelPlazaGroup[]> => {
          if (!response.ok)
            throw new Error(`Sub2API model plaza request failed: ${response.status}`);
          const body = (await readBoundedJson(response, 'Sub2API model plaza', maxBodyBytes)) as {
            code?: number;
            data?: { groups?: Sub2apiModelPlazaGroup[] };
          };
          return body?.code === 0 && Array.isArray(body.data?.groups) ? body.data.groups : [];
        },
      ),
    ]);

    if (
      billing.object !== 'sub2api.key_billing' ||
      billing.billing_scope !== 'token' ||
      billing.peak_rate_enabled === true
    ) {
      return {
        items: [],
        status: 'unsafe',
        warnings:
          billing.peak_rate_enabled === true
            ? ['Sub2API peak pricing cannot be represented safely; existing pricing was cleared']
            : ['Sub2API billing metadata is incomplete; existing pricing was cleared'],
      };
    }

    const tokenMultiplier = toNonNegativeNumber(billing.resolved_rate_multiplier);
    if (tokenMultiplier === undefined) {
      return {
        items: [],
        status: 'unsafe',
        warnings: ['Sub2API resolved billing multiplier is unavailable'],
      };
    }

    const matchingGroups = plazaGroups.filter((group) =>
      sameRate(group.rate_multiplier, billing.group_rate_multiplier),
    );
    if (matchingGroups.length === 0) {
      return {
        items: [],
        status: 'unsafe',
        warnings: ['Sub2API API key group was not available in the model plaza'],
      };
    }

    const candidatesByModel = new Map<
      string,
      Array<{ group: Sub2apiModelPlazaGroup; pricing: Sub2apiModelPricing }>
    >();
    for (const group of matchingGroups) {
      for (const model of group.models ?? []) {
        const modelId = model.name?.trim();
        if (!modelId || !model.pricing) continue;
        const candidates = candidatesByModel.get(modelId) ?? [];
        candidates.push({ group, pricing: model.pricing });
        candidatesByModel.set(modelId, candidates);
      }
    }

    const warnings: string[] = [];
    const items: NewapiRemotePricing[] = [];
    let unsupportedCount = 0;
    for (const [modelId, candidates] of candidatesByModel) {
      const signatures = new Set(
        candidates.map(({ group, pricing }) =>
          JSON.stringify({
            imageRateIndependent: group.image_rate_independent === true,
            imageRateMultiplier: group.image_rate_multiplier,
            pricing,
          }),
        ),
      );
      if (signatures.size !== 1) {
        warnings.push(`Skipped ambiguous Sub2API pricing for model ${modelId}`);
        continue;
      }

      const [{ group, pricing }] = candidates;
      const imageMultiplier =
        group.image_rate_independent === true
          ? (toNonNegativeNumber(group.image_rate_multiplier) ?? tokenMultiplier)
          : tokenMultiplier;
      const resolvedPricing = resolveSub2apiModelPricing({
        imageMultiplier,
        modelId,
        pricing,
        tokenMultiplier,
      });
      if (!resolvedPricing) {
        unsupportedCount += 1;
        continue;
      }

      items.push({ model_name: modelId, resolvedPricing });
    }

    if (unsupportedCount > 0) {
      warnings.push(
        `Skipped ${unsupportedCount} Sub2API model prices that cannot be represented safely`,
      );
    }

    return {
      items,
      status: warnings.length > 0 ? 'unsafe' : 'available',
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch {
    return { items: [], status: 'unavailable' };
  }
};

export const fetchNewapiModels = async ({
  apiKey,
  baseUrl,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  providerType,
  timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS,
}: {
  apiKey: string;
  baseUrl: string;
  maxBodyBytes?: number;
  providerType?: AdminModelApiProviderType | string | null;
  timeoutMs?: number;
}): Promise<NewapiRemoteModel[]> => {
  return fetchWithTimeout(
    urlJoin(normalizeNewapiApiBase(baseUrl), '/models'),
    { headers: buildModelListHeaders({ apiKey, providerType }) },
    'AI provider models',
    timeoutMs,
    async (response) => {
      if (!response.ok) {
        throw new Error(`AI provider models request failed: ${response.status}`);
      }

      const contentType = response.headers?.get('content-type') ?? '';
      if (contentType && !contentType.toLowerCase().includes('application/json')) {
        throw new Error(
          'AI provider models endpoint did not return JSON. Check that the base URL is an API endpoint.',
        );
      }

      let body: unknown;
      try {
        body = await readBoundedJson(response, 'AI provider models', maxBodyBytes);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === `AI provider models response exceeded the ${maxBodyBytes} byte limit`
        ) {
          throw error;
        }

        throw new Error(
          'AI provider models endpoint did not return JSON. Check that the base URL is an API endpoint.',
          { cause: error },
        );
      }

      if (Array.isArray(body)) return body;
      if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
        return (body as { data: NewapiRemoteModel[] }).data;
      }

      return [];
    },
  );
};

export const fetchNewapiPricing = async ({
  apiKey,
  baseUrl,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  providerType = 'newapi',
  timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS,
}: {
  apiKey: string;
  baseUrl: string;
  maxBodyBytes?: number;
  providerType?: AdminModelApiProviderType | string | null;
  timeoutMs?: number;
}): Promise<NewapiPricingFetchResult> => {
  if (!supportsNewapiPricingSync(providerType)) return { items: [], status: 'unsupported' };

  if (providerType === 'sub2api') {
    return fetchSub2apiPricing({ apiKey, baseUrl, maxBodyBytes, timeoutMs });
  }

  try {
    return await fetchWithTimeout(
      urlJoin(normalizeNewapiRoot(baseUrl), '/api/pricing'),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      'NewAPI pricing',
      timeoutMs,
      async (response): Promise<NewapiPricingFetchResult> => {
        if (!response.ok) return { items: [], status: 'unavailable' };

        const contentType = response.headers?.get('content-type') ?? '';
        if (contentType && !contentType.toLowerCase().includes('application/json')) {
          return { items: [], status: 'unavailable' };
        }

        const body = await readBoundedJson(response, 'NewAPI pricing', maxBodyBytes);
        if (
          body &&
          typeof body === 'object' &&
          (body as { success?: boolean }).success &&
          Array.isArray((body as { data?: unknown }).data)
        ) {
          return {
            items: (body as { data: NewapiRemotePricing[] }).data,
            status: 'available',
          };
        }

        return { items: [], status: 'unavailable' };
      },
    );
  } catch {
    return { items: [], status: 'unavailable' };
  }
};
