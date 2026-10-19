import { createHash } from 'node:crypto';

import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import {
  AgentRuntimeError,
  type ASRPayload,
  type ASRUsage,
  type ChatStreamPayload,
  resolveImageSinglePrice,
  resolveVideoSinglePrice,
} from '@lobechat/model-runtime';
import {
  aiUsagePricingRuleSchema,
  ChatErrorType,
  type ModuleAppBillingPayer,
} from '@lobechat/types';
import {
  getAudioInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@lobechat/utils';
import { type AiProviderModelListItem, type Pricing } from 'model-bank';
import { z } from 'zod';

import { AiProviderModel } from '@/database/models/aiProvider';
import {
  type AiUsageCreditQuote,
  type AiUsageRouteMetadata,
  CommercialModel,
} from '@/database/models/commercial';
import { ModuleAppCreditModel } from '@/database/models/moduleAppCredit';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { type LobeChatDatabase } from '@/database/type';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type ProviderConfig } from '@/types/user/settings';

import { getAdminNewapiModelCard, resolveAdminNewapiModelPricing } from './adminNewapiPricing';
import { getServerModelPricingSnapshot, type ServerModelPricingSource } from './serverModelPricing';

const USER_MANAGED_CREDENTIAL_FIELDS = [
  'accessKeyId',
  'apiKey',
  'bearerToken',
  'oauthAccessToken',
  'password',
  'secretAccessKey',
  'sessionToken',
  'username',
] as const;

const APPROX_CHARS_PER_TOKEN = 4;
const APPROX_IMAGE_INPUT_TOKENS = 1024;
const APPROX_VIDEO_INPUT_TOKENS = 2048;
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 1024;
const MIN_ESTIMATED_OUTPUT_TOKENS = 256;
const HARD_MAX_ESTIMATED_OUTPUT_TOKENS = 1_000_000;
const MAX_RESERVATION_IDEMPOTENCY_KEY_LENGTH = 240;
const ASR_ESTIMATED_AUDIO_TOKENS_PER_SECOND = 50;
const ASR_ESTIMATED_MIN_BYTES_PER_SECOND = 1000;
const ASR_ESTIMATED_OUTPUT_TOKENS = 2000;
const ASR_MISSING_USAGE_MAX_USD = 0.01;
const EXTERNAL_SUBSCRIPTION_PROVIDERS = new Set(['supergrok']);
const TRUSTED_FREE_PRICING_SOURCES = new Set<ServerModelPricingSource>([
  'lobehub-official',
  'model-bank',
]);
const MAX_PRICING_SNAPSHOT_RATE = 1_000_000_000_000;
const MAX_PRICING_SNAPSHOT_UNITS = 100;
const MAX_PRICING_SNAPSHOT_TIERS = 10_000;
const MAX_PRICING_SNAPSHOT_LOOKUP_ENTRIES = 10_000;

const pricingSnapshotRateSchema = z.number().finite().nonnegative().max(MAX_PRICING_SNAPSHOT_RATE);
const pricingUnitNameSchema = z.enum([
  'textInput',
  'textOutput',
  'textInput_cacheRead',
  'textInput_cacheWrite',
  'audioInput',
  'audioOutput',
  'audioInput_cacheRead',
  'imageGeneration',
  'imageInput',
  'imageInput_cacheRead',
  'imageOutput',
  'videoInput',
  'videoGeneration',
]);
const pricingUnitTypeSchema = z.enum([
  'millionTokens',
  'millionCharacters',
  'image',
  'video',
  'megapixel',
  'second',
]);
const pricingUnitBaseShape = {
  name: pricingUnitNameSchema,
  unit: pricingUnitTypeSchema,
};
const pricingLookupRatesSchema = z
  .record(z.string().min(1).max(240), pricingSnapshotRateSchema)
  .refine(
    (rates) => Object.keys(rates).length <= MAX_PRICING_SNAPSHOT_LOOKUP_ENTRIES,
    'pricing lookup contains too many entries',
  );
const pricingSnapshotSchema = z
  .object({
    approximatePricePerImage: pricingSnapshotRateSchema.optional(),
    approximatePricePerVideo: pricingSnapshotRateSchema.optional(),
    currency: z.enum(['CNY', 'USD']).optional(),
    units: z
      .array(
        z.discriminatedUnion('strategy', [
          z
            .object({
              ...pricingUnitBaseShape,
              originalRate: pricingSnapshotRateSchema.optional(),
              rate: pricingSnapshotRateSchema,
              strategy: z.literal('fixed'),
            })
            .strict(),
          z
            .object({
              ...pricingUnitBaseShape,
              strategy: z.literal('tiered'),
              tiers: z
                .array(
                  z
                    .object({
                      originalRate: pricingSnapshotRateSchema.optional(),
                      rate: pricingSnapshotRateSchema,
                      upTo: z.union([
                        z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
                        z.literal('infinity'),
                      ]),
                    })
                    .strict(),
                )
                .max(MAX_PRICING_SNAPSHOT_TIERS),
            })
            .strict(),
          z
            .object({
              ...pricingUnitBaseShape,
              lookup: z
                .object({
                  originalPrices: pricingLookupRatesSchema.optional(),
                  prices: pricingLookupRatesSchema,
                  pricingParams: z.array(z.string().min(1).max(240)).max(100),
                })
                .strict(),
              strategy: z.literal('lookup'),
            })
            .strict(),
        ]),
      )
      .max(MAX_PRICING_SNAPSHOT_UNITS),
  })
  .strict();

const commercialPricingQuoteSchema = z
  .object({
    baseEstimatedCredits: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
    creditsPerDollar: z.number().finite().positive().max(MAX_PRICING_SNAPSHOT_RATE),
    matchedPricingRule: aiUsagePricingRuleSchema.nullable(),
    modelPricing: pricingSnapshotSchema.optional(),
    modelPricingSource: z.enum(['database', 'lobehub-official', 'missing', 'model-bank']),
    pricingMultiplier: z.number().finite().positive().max(1000),
    quotedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

const buildCommercialReservationIdempotencyKey = (
  payer: ModuleAppBillingPayer,
  usageType: CommercialBillableUsageType,
  operationId: string,
) => {
  const payerKey =
    payer.scopeType === 'personal' ? `personal:${payer.userId}` : `workspace:${payer.workspaceId}`;
  const key = `commercial-ai:${payerKey}:${usageType}:${operationId}`;
  if (key.length <= MAX_RESERVATION_IDEMPOTENCY_KEY_LENGTH) return key;

  return `commercial-ai:${createHash('sha256').update(key).digest('hex')}`;
};

const resolveCommercialBillingPayer = ({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId?: string;
}): ModuleAppBillingPayer =>
  workspaceId ? { scopeType: 'workspace', workspaceId } : { scopeType: 'personal', userId };

const hasUserManagedCredential = (keyVaults?: Record<string, unknown>) =>
  USER_MANAGED_CREDENTIAL_FIELDS.some((field) => {
    const value = keyVaults?.[field];
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  });

const estimateTextTokens = (value?: string | null) =>
  Math.max(0, Math.ceil((value?.length ?? 0) / APPROX_CHARS_PER_TOKEN));

const estimateMessageTokens = (message: ChatStreamPayload['messages'][number]) => {
  let total = estimateTextTokens(message.name) + estimateTextTokens(message.tool_call_id);

  if (typeof message.content === 'string') {
    total += estimateTextTokens(message.content);
  } else {
    total += (message.content || []).reduce((sum, part) => {
      switch (part.type) {
        case 'image_url': {
          return sum + APPROX_IMAGE_INPUT_TOKENS;
        }
        case 'thinking': {
          return sum + estimateTextTokens(part.thinking);
        }
        case 'text': {
          return sum + estimateTextTokens(part.text);
        }
        case 'video_url': {
          return sum + APPROX_VIDEO_INPUT_TOKENS;
        }
        default: {
          return sum;
        }
      }
    }, 0);
  }

  total += estimateTextTokens(message.reasoning?.content);
  total += (message.tool_calls || []).reduce(
    (sum, toolCall) =>
      sum +
      estimateTextTokens(toolCall.id) +
      estimateTextTokens(toolCall.function?.name) +
      estimateTextTokens(toolCall.function?.arguments),
    0,
  );

  return total;
};

const estimatePayloadInputTokens = (payload: ChatStreamPayload) =>
  Math.max(
    0,
    payload.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
  );

const estimatePayloadOutputTokens = (
  payload: ChatStreamPayload,
  modelCard?: Pick<AiProviderModelListItem, 'contextWindowTokens'>,
) => {
  const requestedTokens =
    typeof payload.max_tokens === 'number' && payload.max_tokens > 0
      ? payload.max_tokens
      : DEFAULT_ESTIMATED_OUTPUT_TOKENS;

  const modelLimit =
    typeof modelCard?.contextWindowTokens === 'number' && modelCard.contextWindowTokens > 0
      ? modelCard.contextWindowTokens
      : HARD_MAX_ESTIMATED_OUTPUT_TOKENS;

  return (
    Math.max(MIN_ESTIMATED_OUTPUT_TOKENS, Math.min(modelLimit, requestedTokens)) *
    Math.max(1, payload.n ?? 1)
  );
};

const estimatePayloadCreditsFromPricing = (
  payload: ChatStreamPayload,
  modelCard?: Pick<AiProviderModelListItem, 'contextWindowTokens' | 'pricing'>,
) => {
  const inputRate = getTextInputUnitRate(modelCard?.pricing);
  const outputRate = getTextOutputUnitRate(modelCard?.pricing);

  if (!inputRate && !outputRate) return undefined;

  const currencyFactor = modelCard?.pricing?.currency === 'CNY' ? 1 / USD_TO_CNY : 1;
  const inputCredits = Math.ceil(
    estimatePayloadInputTokens(payload) * (inputRate ?? 0) * currencyFactor,
  );
  const outputCredits = Math.ceil(
    estimatePayloadOutputTokens(payload, modelCard) * (outputRate ?? 0) * currencyFactor,
  );

  return Math.max(1, inputCredits + outputCredits);
};

const getProviderModelCard = async ({
  db,
  model,
  modelType = 'chat',
  provider,
  routeMetadata,
  userId,
}: {
  db: LobeChatDatabase;
  model: string;
  modelType?: AiProviderModelListItem['type'];
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  userId: string;
}) => {
  const adminModelCard = await getAdminNewapiModelCard({
    db,
    model,
    provider,
    routeMetadata,
    type: modelType,
  });
  if (adminModelCard) {
    const resolution = await resolveAdminNewapiModelPricing({ adminModelCard, model });
    return resolution.pricing
      ? {
          ...adminModelCard.modelCard,
          pricing: resolution.pricing,
          pricingSource: resolution.source,
        }
      : { ...adminModelCard.modelCard, pricingSource: resolution.source };
  }

  const { aiProvider } = await getServerGlobalConfig(db);
  const aiInfraRepos = new AiInfraRepos(db, userId, aiProvider as Record<string, ProviderConfig>);
  const models = await aiInfraRepos.getAiProviderModelList(provider, { type: modelType });

  return models.find((item) => item.id === model);
};

export const estimateCommercialChatCredits = async ({
  db,
  payload,
  provider,
  routeMetadata,
  userId,
}: {
  db: LobeChatDatabase;
  payload: ChatStreamPayload;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  userId: string;
}) => {
  const modelCard = await getProviderModelCard({
    db,
    model: payload.model,
    provider,
    routeMetadata,
    userId,
  });

  return estimatePayloadCreditsFromPricing(payload, modelCard);
};

const estimateEmbeddingInputTokens = (input: unknown): number => {
  if (typeof input === 'string') return estimateTextTokens(input);
  if (!Array.isArray(input)) return 0;
  if (input.every((item) => typeof item === 'number')) return input.length;

  return input.reduce<number>((sum, item) => sum + estimateEmbeddingInputTokens(item), 0);
};

export const estimateCommercialEmbeddingsCredits = async ({
  db,
  input,
  model,
  provider,
  routeMetadata,
  userId,
}: {
  db: LobeChatDatabase;
  input: unknown;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  userId: string;
}) => {
  const modelCard = await getProviderModelCard({
    db,
    model,
    modelType: 'embedding',
    provider,
    routeMetadata,
    userId,
  });
  const inputRate = getTextInputUnitRate(modelCard?.pricing);
  if (!inputRate) return undefined;

  const currencyFactor = modelCard?.pricing?.currency === 'CNY' ? 1 / USD_TO_CNY : 1;
  return Math.max(1, Math.ceil(estimateEmbeddingInputTokens(input) * inputRate * currencyFactor));
};

const getAsrEstimatedUsage = (
  payload: ASRPayload,
): Required<Pick<ASRUsage, 'durationSeconds' | 'inputAudioTokens' | 'totalOutputTokens'>> => {
  const durationSeconds = Math.max(
    1,
    Math.ceil(payload.file.size / ASR_ESTIMATED_MIN_BYTES_PER_SECOND),
  );

  return {
    durationSeconds,
    inputAudioTokens: durationSeconds * ASR_ESTIMATED_AUDIO_TOKENS_PER_SECOND,
    totalOutputTokens: ASR_ESTIMATED_OUTPUT_TOKENS,
  };
};

const resolveAsrUsdCost = (
  pricing: AiProviderModelListItem['pricing'],
  usage: ASRUsage,
): number | undefined => {
  if (!pricing) return undefined;

  const audioUnit = pricing.units.find((unit) => unit.name === 'audioInput');
  const audioRate = getAudioInputUnitRate(pricing) ?? 0;
  const textInputRate = getTextInputUnitRate(pricing) ?? 0;
  const textOutputRate = getTextOutputUnitRate(pricing) ?? 0;
  const audioTokens =
    usage.inputAudioTokens ??
    (usage.totalInputTokens !== undefined
      ? Math.max(0, usage.totalInputTokens - (usage.inputTextTokens ?? 0))
      : 0);
  const audioCost =
    audioUnit?.unit === 'second'
      ? (usage.durationSeconds ?? 0) * audioRate
      : (audioTokens * audioRate) / 1_000_000;
  const textInputCost = ((usage.inputTextTokens ?? 0) * textInputRate) / 1_000_000;
  const textOutputCost = ((usage.totalOutputTokens ?? 0) * textOutputRate) / 1_000_000;
  const cost = audioCost + textInputCost + textOutputCost;
  const usdCost = pricing.currency === 'CNY' ? cost / USD_TO_CNY : cost;

  return Number.isFinite(usdCost) && usdCost > 0 ? usdCost : undefined;
};

const quoteCommercialAsrUsage = async ({
  db,
  model,
  payload,
  provider,
  routeMetadata,
  usage,
  userId,
}: {
  db: LobeChatDatabase;
  model: string;
  payload: ASRPayload;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  usage?: ASRUsage;
  userId: string;
}) => {
  const snapshot = await getServerModelPricingSnapshot({
    db,
    model,
    provider,
    routeMetadata,
    type: 'asr',
    userId,
  });
  const estimatedUsage = getAsrEstimatedUsage(payload);
  const estimatedUsdCost = resolveAsrUsdCost(snapshot.pricing, estimatedUsage);
  const audioUnit = snapshot.pricing?.units.find((unit) => unit.name === 'audioInput');
  const billableProviderUsage =
    usage && audioUnit?.unit === 'second' && usage.durationSeconds === undefined
      ? { ...usage, durationSeconds: estimatedUsage.durationSeconds }
      : usage;
  const providerUsdCost = billableProviderUsage
    ? resolveAsrUsdCost(snapshot.pricing, billableProviderUsage)
    : undefined;
  const usdCost =
    providerUsdCost ??
    (estimatedUsdCost === undefined
      ? undefined
      : Math.min(estimatedUsdCost, ASR_MISSING_USAGE_MAX_USD));
  if (!usdCost) return undefined;

  return { amount: Math.max(1, Math.ceil(usdCost * CREDITS_PER_DOLLAR)), usdCost };
};

export const estimateCommercialAsrCredits = async (
  params: Omit<Parameters<typeof quoteCommercialAsrUsage>[0], 'usage'>,
) => {
  const snapshot = await getServerModelPricingSnapshot({
    db: params.db,
    model: params.model,
    provider: params.provider,
    routeMetadata: params.routeMetadata,
    type: 'asr',
    userId: params.userId,
  });
  const usdCost = resolveAsrUsdCost(snapshot.pricing, getAsrEstimatedUsage(params.payload));
  if (!usdCost) return undefined;

  return Math.max(1, Math.ceil(usdCost * CREDITS_PER_DOLLAR));
};

export const resolveCommercialAsrCredits = async (
  params: Parameters<typeof quoteCommercialAsrUsage>[0],
) => (await quoteCommercialAsrUsage(params))?.amount;

export const shouldChargeCommercialUsage = async ({
  db,
  provider,
  userId,
}: {
  db: LobeChatDatabase;
  provider: string;
  userId: string;
}) => {
  const normalizedProvider = provider.toLowerCase();
  if (EXTERNAL_SUBSCRIPTION_PROVIDERS.has(normalizedProvider)) return false;
  if (normalizedProvider === BRANDING_PROVIDER) return true;

  const providerModel = new AiProviderModel(db, userId);
  const providerConfig = await providerModel.getAiProviderById(
    provider,
    KeyVaultsGateKeeper.getUserKeyVaults,
  );

  return !hasUserManagedCredential(
    providerConfig?.keyVaults as Record<string, unknown> | undefined,
  );
};

export type CommercialBillableUsageType = CommercialAiUsageType | 'image' | 'video';

export interface CommercialUsageReservationHandle {
  estimatedCredits: number;
  operationId: string;
  pricingQuote?: CommercialPricingQuote;
  reservationId: string;
  usageType: CommercialBillableUsageType;
}

export interface CommercialPricingQuote {
  baseEstimatedCredits: number;
  creditsPerDollar: number;
  matchedPricingRule: AiUsageCreditQuote['matchedPricingRule'];
  modelPricing?: Pricing;
  modelPricingSource: 'database' | 'lobehub-official' | 'missing' | 'model-bank';
  pricingMultiplier: number;
  quotedAt: string;
  version: 1;
}

export const isCommercialPricingQuote = (value: unknown): value is CommercialPricingQuote => {
  return commercialPricingQuoteSchema.safeParse(value).success;
};

export const applyCommercialPricingQuoteToCredits = (
  baseCredits: number,
  pricingQuote?: CommercialPricingQuote,
) => {
  const normalizedBase = Math.max(0, Number.isFinite(baseCredits) ? baseCredits : 0);
  if (!pricingQuote) return Math.ceil(normalizedBase);

  return Math.ceil(
    (normalizedBase / CREDITS_PER_DOLLAR) *
      pricingQuote.creditsPerDollar *
      pricingQuote.pricingMultiplier,
  );
};

export const isCommercialUsageReservationHandle = (
  value: unknown,
  usageType?: CommercialBillableUsageType,
): value is CommercialUsageReservationHandle => {
  if (!value || typeof value !== 'object') return false;

  const handle = value as Partial<CommercialUsageReservationHandle>;
  return (
    typeof handle.reservationId === 'string' &&
    handle.reservationId.length > 0 &&
    typeof handle.operationId === 'string' &&
    handle.operationId.length > 0 &&
    typeof handle.estimatedCredits === 'number' &&
    Number.isFinite(handle.estimatedCredits) &&
    handle.estimatedCredits > 0 &&
    typeof handle.usageType === 'string' &&
    (handle.pricingQuote === undefined || isCommercialPricingQuote(handle.pricingQuote)) &&
    (!usageType || handle.usageType === usageType)
  );
};

const isPositiveFinite = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const getPricingUnitRates = (unit: Pricing['units'][number]): number[] => {
  if (unit.strategy === 'fixed') return [unit.rate];
  if (unit.strategy === 'tiered') return unit.tiers.map((tier) => tier.rate);

  return Object.values(unit.lookup.prices);
};

const isExplicitlyFreePricing = (pricing: Pricing, usageType: CommercialBillableUsageType) => {
  if (usageType === 'image' || usageType === 'video') return false;

  const unitNames =
    usageType === 'chat' || usageType === 'generate_object'
      ? new Set(['textInput', 'textOutput'])
      : usageType === 'embeddings'
        ? new Set(['textInput'])
        : new Set(['audioInput', 'textInput', 'textOutput']);
  const rates = pricing.units
    .filter((unit) => unitNames.has(unit.name))
    .flatMap(getPricingUnitRates);

  return rates.length > 0 && rates.every((rate) => Number.isFinite(rate) && rate === 0);
};

const hasTrustedFreePricing = (
  pricing: Pricing | undefined,
  source: ServerModelPricingSource | undefined,
  usageType: CommercialBillableUsageType,
) =>
  Boolean(
    pricing &&
    source &&
    TRUSTED_FREE_PRICING_SOURCES.has(source) &&
    isExplicitlyFreePricing(pricing, usageType),
  );

const hasReliablePricing = (
  pricing: AiProviderModelListItem['pricing'],
  usageType: CommercialBillableUsageType,
  source?: ServerModelPricingSource,
) => {
  if (!pricing) return false;
  if (hasTrustedFreePricing(pricing, source, usageType)) return true;

  if (usageType === 'chat' || usageType === 'generate_object') {
    return (
      isPositiveFinite(getTextInputUnitRate(pricing)) ||
      isPositiveFinite(getTextOutputUnitRate(pricing))
    );
  }
  if (usageType === 'embeddings') {
    return isPositiveFinite(getTextInputUnitRate(pricing));
  }
  if (usageType === 'asr') {
    return (
      isPositiveFinite(getAudioInputUnitRate(pricing)) ||
      isPositiveFinite(getTextInputUnitRate(pricing)) ||
      isPositiveFinite(getTextOutputUnitRate(pricing))
    );
  }
  if (usageType === 'image') {
    const singlePrice = resolveImageSinglePrice(pricing);
    return isPositiveFinite(singlePrice.price) || isPositiveFinite(singlePrice.approximatePrice);
  }

  const singlePrice = resolveVideoSinglePrice(pricing);
  return (
    isPositiveFinite(singlePrice.approximatePrice) ||
    pricing.units.some((unit) => {
      if (unit.name !== 'videoGeneration') return false;
      if (unit.strategy === 'fixed') return isPositiveFinite(unit.rate);
      if (unit.strategy === 'tiered') {
        return unit.tiers.some((tier) => isPositiveFinite(tier.rate));
      }

      return Object.values(unit.lookup.prices).some(isPositiveFinite);
    })
  );
};

export const assertCommercialModelSellable = async ({
  db,
  model,
  provider,
  routeMetadata,
  usageType,
  userId,
}: {
  db: LobeChatDatabase;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  usageType: CommercialBillableUsageType;
  userId: string;
}): Promise<boolean> => {
  const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
  if (!shouldCharge) return false;

  const snapshot = await getServerModelPricingSnapshot({
    db,
    model,
    provider,
    routeMetadata,
    type:
      usageType === 'generate_object'
        ? 'chat'
        : usageType === 'embeddings'
          ? 'embedding'
          : usageType,
    userId,
  });
  if (hasReliablePricing(snapshot.pricing, usageType, snapshot.source)) return true;

  throw AgentRuntimeError.createError(ChatErrorType.Forbidden, {
    message: 'COMMERCIAL_MODEL_PRICING_MISSING',
    model,
    pricingSource: snapshot.source,
    provider,
    reason: 'COMMERCIAL_MODEL_NOT_SELLABLE',
    usageType,
  });
};

export const assertCommercialChatBudget = async ({
  db,
  payload,
  provider,
  routeMetadata,
  userId,
}: {
  db: LobeChatDatabase;
  payload?: ChatStreamPayload;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  userId: string;
}) => {
  const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
  if (!shouldCharge) return;

  const commercialModel = new CommercialModel(db, userId);
  const estimatedCredits =
    payload && payload.model
      ? await estimateCommercialChatCredits({ db, payload, provider, routeMetadata, userId })
      : undefined;
  const canStart = await commercialModel.canStartChatUsage(estimatedCredits);
  if (canStart) return;

  const accountSummary = await commercialModel.getCreditAccountSummary();
  const requiredCredits =
    typeof estimatedCredits === 'number' && Number.isFinite(estimatedCredits)
      ? Math.max(1, Math.ceil(estimatedCredits))
      : undefined;
  const availableCredits = Math.max(0, Math.floor(accountSummary.balance ?? 0));
  const shortfallCredits =
    requiredCredits === undefined ? undefined : Math.max(0, requiredCredits - availableCredits);

  throw AgentRuntimeError.createError(ChatErrorType.InsufficientBudgetForModel, {
    availableCredits,
    currency: accountSummary.currency,
    message: 'COMMERCIAL_BALANCE_EXHAUSTED',
    model: payload?.model,
    provider,
    requiredCredits,
    shortfallCredits,
  });
};

// SECURITY: P1 fix 2026-04-27 - cost=0 fallback to local pricing to prevent gateway bypass
// Conservative fallback rates (USD per million tokens) matching Claude Sonnet pricing tier.
// Used only when modelCard pricing is also unavailable.
const FALLBACK_INPUT_RATE_USD_PER_M = 3;
const FALLBACK_OUTPUT_RATE_USD_PER_M = 15;

const normalizeUsageTokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export type CostSource = 'fallback-rate' | 'gateway' | 'local-pricing';
export type CommercialAiUsageType = 'asr' | 'chat' | 'embeddings' | 'generate_object';
export type CommercialUsagePayload = {
  cost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
};

/**
 * Resolve the effective USD cost and audit source for a chat usage event.
 *
 * Priority:
 *   1. gateway  — positive finite usage.cost (trust upstream)
 *   2. local-pricing — compute from modelCard.pricing rates × token counts
 *   3. fallback-rate — conservative fixed rate when modelCard has no pricing
 *   4. null — no cost signal and no tokens; cannot bill, caller logs a warning
 */
const resolveEffectiveCost = (
  usage: CommercialUsagePayload,
  modelCard?: Pick<AiProviderModelListItem, 'pricing'> & {
    pricingSource?: ServerModelPricingSource;
  },
  usageType: CommercialAiUsageType = 'chat',
): { costSource: CostSource; usdCost: number } | null => {
  // Tier 1: gateway cost is valid
  if (isPositiveFinite(usage.cost)) {
    return { costSource: 'gateway', usdCost: usage.cost! };
  }

  if (hasTrustedFreePricing(modelCard?.pricing, modelCard?.pricingSource, usageType)) {
    return { costSource: 'local-pricing', usdCost: 0 };
  }

  if (hasTrustedFreePricing(modelCard?.pricing, modelCard?.pricingSource, usageType)) {
    return { costSource: 'local-pricing', usdCost: 0 };
  }

  // Tiers 2 & 3 require at least some token counts
  const inputTokens = normalizeUsageTokenCount(
    usage.totalInputTokens ?? (usageType === 'embeddings' ? usage.totalTokens : 0),
  );
  const outputTokens = normalizeUsageTokenCount(
    usage.totalOutputTokens ?? (usageType === 'embeddings' ? 0 : usage.totalTokens),
  );

  if (inputTokens <= 0 && outputTokens <= 0) {
    console.warn('[billing] cost=0 and no token counts for usage record — skipping charge', {
      usage,
    });
    return null;
  }

  // Tier 2: local pricing from modelCard
  const inputRate = getTextInputUnitRate(modelCard?.pricing);
  const outputRate = getTextOutputUnitRate(modelCard?.pricing);

  if (inputRate !== undefined || outputRate !== undefined) {
    const cost = (inputTokens * (inputRate ?? 0) + outputTokens * (outputRate ?? 0)) / 1_000_000;
    const usdCost = modelCard?.pricing?.currency === 'CNY' ? cost / USD_TO_CNY : cost;

    if (Number.isFinite(usdCost) && usdCost > 0) {
      return { costSource: 'local-pricing', usdCost };
    }
  }

  // Tier 3: conservative fallback fixed rate
  const usdCost =
    (inputTokens * FALLBACK_INPUT_RATE_USD_PER_M + outputTokens * FALLBACK_OUTPUT_RATE_USD_PER_M) /
    1_000_000;

  console.warn(
    '[billing] cost=0 and no modelCard pricing — using fallback rate',
    `($${FALLBACK_INPUT_RATE_USD_PER_M}/M input, $${FALLBACK_OUTPUT_RATE_USD_PER_M}/M output)`,
    { model: modelCard, usdCost, usage },
  );

  return Number.isFinite(usdCost) && usdCost > 0 ? { costSource: 'fallback-rate', usdCost } : null;
};

export const assertCommercialMinimumBudget = async ({
  db,
  model,
  provider,
  requiredCredits = 1,
  userId,
}: {
  db: LobeChatDatabase;
  model?: string;
  provider: string;
  requiredCredits?: number;
  userId: string;
}) => {
  const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
  if (!shouldCharge) return;

  const commercialModel = new CommercialModel(db, userId);
  const normalizedRequiredCredits = Math.max(1, Math.ceil(requiredCredits));
  const canStart = await commercialModel.canStartChatUsage(normalizedRequiredCredits);
  if (canStart) return;

  const accountSummary = await commercialModel.getCreditAccountSummary();
  const availableCredits = Math.max(0, Math.floor(accountSummary.balance ?? 0));

  throw AgentRuntimeError.createError(ChatErrorType.InsufficientBudgetForModel, {
    availableCredits,
    currency: accountSummary.currency,
    message: 'COMMERCIAL_BALANCE_EXHAUSTED',
    model,
    provider,
    requiredCredits: normalizedRequiredCredits,
    shortfallCredits: Math.max(0, normalizedRequiredCredits - availableCredits),
  });
};

export const recordCommercialAiUsage = async ({
  db,
  model,
  operationId,
  provider,
  referenceId,
  referenceType,
  routeMetadata,
  title,
  usage,
  usageType,
  userId,
}: {
  db: LobeChatDatabase;
  model: string;
  operationId?: string;
  provider: string;
  referenceId: string;
  referenceType: string;
  routeMetadata?: AiUsageRouteMetadata;
  title?: string;
  usage?: CommercialUsagePayload;
  usageType: CommercialAiUsageType;
  userId: string;
}) => {
  const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
  if (!shouldCharge) return null;
  if (!usage) return null;

  const modelCard = await getProviderModelCard({
    db,
    model,
    modelType: usageType === 'embeddings' ? 'embedding' : usageType === 'asr' ? 'asr' : 'chat',
    provider,
    routeMetadata,
    userId,
  });
  const resolved = resolveEffectiveCost(usage, modelCard, usageType);

  if (!resolved) return null;

  const { usdCost, costSource } = resolved;
  const commercialModel = new CommercialModel(db, userId);

  return commercialModel.consumeCreditsForAiUsage({
    model,
    operationId,
    provider,
    referenceId,
    referenceType,
    routeMetadata,
    title,
    usage: {
      ...usage,
      // Override cost with the resolved value so CommercialModel bills correctly.
      // costSource is recorded in the ledger metadata for audit purposes.
      cost: usdCost,
      // Attach costSource as a non-standard audit field accepted by CommercialModel.
      costSource,
    } as typeof usage & { costSource: CostSource },
    usageType,
  });
};

export const reserveCommercialAiUsage = async ({
  db,
  estimatedCredits,
  model,
  operationId,
  provider,
  reservationTtlMs,
  routeMetadata,
  usageType,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  estimatedCredits?: number;
  model: string;
  operationId: string;
  provider: string;
  reservationTtlMs?: number;
  routeMetadata?: AiUsageRouteMetadata;
  usageType: CommercialBillableUsageType;
  userId: string;
  workspaceId?: string;
}) => {
  const shouldCharge = await assertCommercialModelSellable({
    db,
    model,
    provider,
    routeMetadata,
    usageType,
    userId,
  });
  if (!shouldCharge) return null;

  const baseEstimatedCredits = Math.max(
    1,
    Math.ceil(
      typeof estimatedCredits === 'number' && Number.isFinite(estimatedCredits)
        ? estimatedCredits
        : 1,
    ),
  );
  const [modelPricingSnapshot, creditQuote] = await Promise.all([
    getServerModelPricingSnapshot({
      db,
      model,
      provider,
      routeMetadata,
      type:
        usageType === 'generate_object'
          ? 'chat'
          : usageType === 'embeddings'
            ? 'embedding'
            : usageType,
      userId,
    }),
    new CommercialModel(db, userId).quoteCreditsForAiUsage({
      model,
      provider,
      routeMetadata,
      usage: { cost: baseEstimatedCredits / CREDITS_PER_DOLLAR },
    }),
  ]);
  const pricingQuote: CommercialPricingQuote = {
    baseEstimatedCredits,
    creditsPerDollar: creditQuote.creditsPerDollar,
    matchedPricingRule: creditQuote.matchedPricingRule,
    modelPricing: modelPricingSnapshot.pricing,
    modelPricingSource: modelPricingSnapshot.source,
    pricingMultiplier: creditQuote.pricingMultiplier,
    quotedAt: new Date().toISOString(),
    version: 1,
  };
  const amount = Math.max(1, creditQuote.amount);
  const creditModel = reservationTtlMs
    ? new ModuleAppCreditModel(db, { reservationTtlMs })
    : new ModuleAppCreditModel(db);
  const payer = resolveCommercialBillingPayer({ userId, workspaceId });

  return creditModel.reserve({
    amount,
    idempotencyKey: buildCommercialReservationIdempotencyKey(payer, usageType, operationId),
    metadata: {
      model,
      operationId,
      pricingQuote,
      provider,
      ...(routeMetadata ? { routeMetadata } : {}),
      usageType,
      ...(workspaceId ? { workspaceId } : {}),
    },
    payer,
    requireNew: true,
  });
};

export const settleCommercialAiUsageReservation = async ({
  actualCredits,
  actualCreditsAreBase = false,
  db,
  estimatedCredits,
  model,
  operationId,
  provider,
  pricingQuote,
  reservationId,
  routeMetadata,
  title = 'AI Usage',
  usage,
  usageType,
  userId,
}: {
  actualCredits?: number;
  actualCreditsAreBase?: boolean;
  db: LobeChatDatabase;
  estimatedCredits?: number;
  model: string;
  operationId: string;
  provider: string;
  pricingQuote?: CommercialPricingQuote;
  reservationId: string;
  routeMetadata?: AiUsageRouteMetadata;
  title?: string;
  usage?: CommercialUsagePayload;
  usageType: CommercialBillableUsageType;
  userId: string;
}) => {
  let actualAmount = Math.max(
    0,
    Math.ceil(
      typeof actualCredits === 'number' && Number.isFinite(actualCredits)
        ? actualCredits
        : (estimatedCredits ?? 1),
    ),
  );
  if (actualCreditsAreBase && actualCredits !== undefined) {
    actualAmount = applyCommercialPricingQuoteToCredits(actualCredits, pricingQuote);
  }
  let billingMetadata: Record<string, unknown> = {
    ...(actualCredits === undefined
      ? { costSource: 'estimated-reservation' }
      : { chargedCredits: actualAmount, costSource: 'generation-pricing' }),
  };

  if (usage && usageType !== 'image' && usageType !== 'video') {
    const modelCard = pricingQuote?.modelPricing
      ? {
          pricing: pricingQuote.modelPricing,
          pricingSource: pricingQuote.modelPricingSource,
        }
      : await getProviderModelCard({
          db,
          model,
          modelType:
            usageType === 'embeddings' ? 'embedding' : usageType === 'asr' ? 'asr' : 'chat',
          provider,
          routeMetadata,
          userId,
        });
    const resolved = resolveEffectiveCost(usage, modelCard, usageType);
    if (resolved) {
      const quote = pricingQuote
        ? {
            amount: Math.ceil(
              resolved.usdCost * pricingQuote.creditsPerDollar * pricingQuote.pricingMultiplier,
            ),
            creditsPerDollar: pricingQuote.creditsPerDollar,
            matchedPricingRule: pricingQuote.matchedPricingRule,
            pricingMultiplier: pricingQuote.pricingMultiplier,
          }
        : await new CommercialModel(db, userId).quoteCreditsForAiUsage({
            model,
            provider,
            routeMetadata,
            usage: { cost: resolved.usdCost },
          });
      actualAmount = Math.max(0, quote.amount);
      billingMetadata = {
        chargedCredits: actualAmount,
        costSource: resolved.costSource,
        creditsPerDollar: quote.creditsPerDollar,
        matchedPricingRule: quote.matchedPricingRule,
        pricingMultiplier: quote.pricingMultiplier,
        usdCost: resolved.usdCost,
      };
    }
  }

  const creditModel = new ModuleAppCreditModel(db);
  const settlementInput = {
    actualAmount,
    ledger: {
      description: `Consumed on ${provider}/${model}`,
      referenceType: 'ai_usage_reservation',
      title,
    },
    metadata: {
      ...billingMetadata,
      ...(pricingQuote ? { pricingQuote } : {}),
      estimatedCredits: Math.max(1, Math.ceil(estimatedCredits ?? 1)),
      model,
      operationId,
      provider,
      ...(routeMetadata ? { routeMetadata } : {}),
      totalInputTokens: usage?.totalInputTokens ?? 0,
      totalOutputTokens: usage?.totalOutputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      usageType,
    },
    reservationId,
  };

  try {
    const settled = await creditModel.settle(settlementInput);
    await creditModel.resolveSettlementFailure(reservationId);
    return settled;
  } catch (error) {
    try {
      await creditModel.recordSettlementFailure({
        actualAmount,
        error,
        payload: settlementInput,
        reservationId,
      });
    } catch (persistenceError) {
      console.error('[billing] failed to persist settlement failure', persistenceError);
    }
    throw error;
  }
};

export const releaseCommercialAiUsageReservation = async ({
  db,
  reason,
  reservationId,
}: {
  db: LobeChatDatabase;
  reason: string;
  reservationId: string;
}) => new ModuleAppCreditModel(db).release({ reason, reservationId });

export const quoteCommercialAiUsage = async ({
  db,
  forceCharge = false,
  model,
  provider,
  routeMetadata,
  usage,
  usageType,
  userId,
}: {
  db: LobeChatDatabase;
  forceCharge?: boolean;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  usage?: CommercialUsagePayload;
  usageType: CommercialAiUsageType;
  userId: string;
}) => {
  const shouldCharge = forceCharge || (await shouldChargeCommercialUsage({ db, provider, userId }));
  if (!shouldCharge || !usage) return null;

  const modelCard = await getProviderModelCard({
    db,
    model,
    modelType: usageType === 'embeddings' ? 'embedding' : usageType === 'asr' ? 'asr' : 'chat',
    provider,
    routeMetadata,
    userId,
  });
  const resolved = resolveEffectiveCost(usage, modelCard, usageType);
  if (!resolved) return null;

  const commercialModel = new CommercialModel(db, userId);
  const quote = await commercialModel.quoteCreditsForAiUsage({
    model,
    provider,
    routeMetadata,
    usage: { cost: resolved.usdCost },
  });

  return {
    credits: quote.amount,
    costSource: resolved.costSource,
    pricing: {
      creditsPerDollar: quote.creditsPerDollar,
      matchedPricingRule: quote.matchedPricingRule,
      multiplier: quote.pricingMultiplier,
    },
    usdCost: quote.usdCost,
  };
};

export const recordCommercialChatUsage = async ({
  db,
  messageId,
  model,
  operationId,
  provider,
  routeMetadata,
  usage,
  userId,
}: {
  db: LobeChatDatabase;
  messageId: string;
  model: string;
  operationId?: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  usage?: CommercialUsagePayload;
  userId: string;
}) => {
  return recordCommercialAiUsage({
    db,
    model,
    operationId,
    provider,
    referenceId: messageId,
    referenceType: 'assistant_message',
    routeMetadata,
    title: 'AI Chat Usage',
    usage,
    usageType: 'chat',
    userId,
  });
};
