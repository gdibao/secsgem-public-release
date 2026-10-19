import { type ModelRuntimeHooks } from '@lobechat/model-runtime';

import { getServerDB } from '@/database/core/db-adaptor';
import { type AiUsageRouteMetadata } from '@/database/models/commercial';

import {
  assertCommercialMinimumBudget,
  type CommercialPricingQuote,
  estimateCommercialAsrCredits,
  estimateCommercialChatCredits,
  estimateCommercialEmbeddingsCredits,
  isCommercialPricingQuote,
  recordCommercialAiUsage,
  recordCommercialChatUsage,
  releaseCommercialAiUsageReservation,
  reserveCommercialAiUsage,
  resolveCommercialAsrCredits,
  settleCommercialAiUsageReservation,
} from './commercialBilling';
import { assertModelPolicyAllowed } from './modelPolicy';
import { assertPlanModelAllowed } from './planModelRules';

const COMMERCIAL_BILLING_REFERENCE_KEYS = [
  'billingOperationId',
  'messageId',
  'assistantMessageId',
  'operationId',
] as const;

const getStringMetadataValue = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const resolveCommercialBillingReferenceId = (metadata?: Record<string, unknown>) => {
  for (const key of COMMERCIAL_BILLING_REFERENCE_KEYS) {
    const value = getStringMetadataValue(metadata, key);
    if (value) return value;
  }

  return undefined;
};

const shouldSkipCommercialBilling = (metadata?: Record<string, unknown>) =>
  metadata?.skipCommercialBilling === true;

const createBillingOperationId = (
  usageType: 'asr' | 'chat' | 'embeddings' | 'generate_object' | 'image' | 'video',
) =>
  [
    usageType,
    globalThis.crypto?.randomUUID?.() ??
      [Date.now(), Math.random().toString(36).slice(2)].join('-'),
  ].join(':');

const COMMERCIAL_RESERVATION_ID_KEY = 'commercialCreditReservationId';
const COMMERCIAL_RESERVATION_ESTIMATE_KEY = 'commercialEstimatedCredits';
const COMMERCIAL_PRICING_QUOTE_KEY = 'commercialPricingQuote';

type CommercialReservationContext = {
  estimatedCredits: number;
  operationId: string;
  pricingQuote?: CommercialPricingQuote;
  reservationId?: string;
};

export function getBusinessModelRuntimeHooks(
  userId: string,
  provider: string,
  routeMetadataOrWorkspaceId?: AiUsageRouteMetadata | string,
  _workspaceId?: string,
): ModelRuntimeHooks | undefined {
  const routeMetadata =
    typeof routeMetadataOrWorkspaceId === 'string' ? undefined : routeMetadataOrWorkspaceId;
  const workspaceId = (
    typeof routeMetadataOrWorkspaceId === 'string' ? routeMetadataOrWorkspaceId : _workspaceId
  )?.trim();
  const reservationByPayload = new WeakMap<object, CommercialReservationContext>();
  const policyProviderAliases = Array.from(
    new Set([routeMetadata?.providerType, routeMetadata ? 'newapi' : undefined].filter(Boolean)),
  ).filter((alias): alias is string => typeof alias === 'string' && alias !== provider);
  const policyParams = (
    db: Awaited<ReturnType<typeof getServerDB>>,
    model: string | undefined,
    usageType: 'asr' | 'chat' | 'embeddings' | 'generate_object' | 'image' | 'video',
  ) => ({
    db,
    model,
    provider,
    ...(policyProviderAliases.length > 0 ? { providerAliases: policyProviderAliases } : {}),
    usageType,
  });
  const resolveReservationContext = (
    payload: object,
    metadata?: Record<string, unknown>,
  ): CommercialReservationContext | undefined => {
    const storedContext = reservationByPayload.get(payload);
    if (storedContext) return storedContext;

    const operationId = resolveCommercialBillingReferenceId(metadata);
    const reservationId = getStringMetadataValue(metadata, COMMERCIAL_RESERVATION_ID_KEY);
    const estimatedCredits = Number(metadata?.[COMMERCIAL_RESERVATION_ESTIMATE_KEY]);
    const rawPricingQuote = metadata?.[COMMERCIAL_PRICING_QUOTE_KEY];
    const pricingQuote = isCommercialPricingQuote(rawPricingQuote) ? rawPricingQuote : undefined;
    if (operationId && Number.isFinite(estimatedCredits) && estimatedCredits > 0) {
      return {
        estimatedCredits,
        operationId,
        ...(pricingQuote ? { pricingQuote } : {}),
        ...(reservationId ? { reservationId } : {}),
      };
    }
    return undefined;
  };
  const storeReservationContext = (
    payload: object,
    options: { metadata?: Record<string, unknown> } | undefined,
    context: CommercialReservationContext,
  ) => {
    reservationByPayload.set(payload, context);
    if (!options) return;
    options.metadata = {
      ...options.metadata,
      [COMMERCIAL_RESERVATION_ESTIMATE_KEY]: context.estimatedCredits,
      ...(context.pricingQuote ? { [COMMERCIAL_PRICING_QUOTE_KEY]: context.pricingQuote } : {}),
      ...(context.reservationId ? { [COMMERCIAL_RESERVATION_ID_KEY]: context.reservationId } : {}),
      operationId: context.operationId,
    };
  };
  const reserveUsage = async ({
    db,
    estimatedCredits,
    model,
    options,
    payload,
    usageType,
  }: {
    db: Awaited<ReturnType<typeof getServerDB>>;
    estimatedCredits?: number;
    model: string;
    options?: { metadata?: Record<string, unknown> };
    payload: object;
    usageType: 'asr' | 'chat' | 'embeddings' | 'generate_object';
  }) => {
    const operationId =
      resolveCommercialBillingReferenceId(options?.metadata) ?? createBillingOperationId(usageType);
    const normalizedEstimate = Math.max(1, Math.ceil(estimatedCredits ?? 1));
    const reservation = await reserveCommercialAiUsage({
      db,
      estimatedCredits: normalizedEstimate,
      model,
      operationId,
      provider,
      ...(routeMetadata ? { routeMetadata } : {}),
      usageType,
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    });
    const reservationPricingQuote = (reservation?.metadata as Record<string, unknown> | undefined)
      ?.pricingQuote;
    storeReservationContext(payload, options, {
      estimatedCredits: reservation?.amount ?? normalizedEstimate,
      operationId,
      ...(isCommercialPricingQuote(reservationPricingQuote)
        ? { pricingQuote: reservationPricingQuote }
        : {}),
      ...(reservation?.id ? { reservationId: reservation.id } : {}),
    });
  };
  const releaseReservation = async (payload: object, metadata?: Record<string, unknown>) => {
    const context = resolveReservationContext(payload, metadata);
    reservationByPayload.delete(payload);
    if (!context?.reservationId) return false;
    const db = await getServerDB();
    await releaseCommercialAiUsageReservation({
      db,
      reason: 'provider_error',
      reservationId: context.reservationId,
    });
    return true;
  };

  return {
    beforeTranscribe: async (payload, options) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'asr'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'asr',
        userId,
      });
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      const estimatedCredits = await estimateCommercialAsrCredits({
        db,
        model: payload.model,
        payload,
        provider,
        routeMetadata,
        userId,
      });
      await reserveUsage({
        db,
        estimatedCredits,
        model: payload.model,
        options,
        payload,
        usageType: 'asr',
      });
    },
    beforeChat: async (payload, options) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'chat'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'chat',
        userId,
      });
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      const estimatedCredits = await estimateCommercialChatCredits({
        db,
        payload,
        provider,
        routeMetadata,
        userId,
      });
      await reserveUsage({
        db,
        estimatedCredits,
        model: payload.model,
        options,
        payload,
        usageType: 'chat',
      });
    },
    beforeEmbeddings: async (payload, options) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'embeddings'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'embedding',
        userId,
      });
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      const estimatedCredits = await estimateCommercialEmbeddingsCredits({
        db,
        input: payload.input,
        model: payload.model,
        provider,
        routeMetadata,
        userId,
      });
      await reserveUsage({
        db,
        estimatedCredits,
        model: payload.model,
        options,
        payload,
        usageType: 'embeddings',
      });
    },
    beforeGenerateObject: async (payload, options) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'generate_object'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'chat',
        userId,
      });
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      const estimatedCredits = await estimateCommercialChatCredits({
        db,
        payload: payload as any,
        provider,
        routeMetadata,
        userId,
      });
      await reserveUsage({
        db,
        estimatedCredits,
        model: payload.model,
        options,
        payload,
        usageType: 'generate_object',
      });
    },
    beforeCreateImage: async (payload) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'image'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'image',
        userId,
      });
      await assertCommercialMinimumBudget({ db, model: payload.model, provider, userId });
    },
    beforeCreateVideo: async (payload) => {
      const db = await getServerDB();
      const groupKey = routeMetadata?.groupKey ?? undefined;
      await assertModelPolicyAllowed(policyParams(db, payload.model, 'video'));
      await assertPlanModelAllowed({
        db,
        ...(groupKey ? { groupKey } : {}),
        model: payload.model,
        modelType: 'video',
        userId,
      });
      await assertCommercialMinimumBudget({ db, model: payload.model, provider, userId });
    },
    onChatFinal: async (data, { options, payload }) => {
      const metadata = options?.metadata;
      if (shouldSkipCommercialBilling(metadata)) return;
      if (data.error) {
        await releaseReservation(payload, metadata);
        return;
      }

      const reservation = resolveReservationContext(payload, metadata);
      reservationByPayload.delete(payload);
      if (reservation?.reservationId) {
        const db = await getServerDB();
        await settleCommercialAiUsageReservation({
          db,
          estimatedCredits: reservation.estimatedCredits,
          model: payload.model,
          operationId: reservation.operationId,
          provider,
          pricingQuote: reservation.pricingQuote,
          reservationId: reservation.reservationId,
          routeMetadata,
          title: 'AI Chat Usage',
          usage: data.usage,
          usageType: 'chat',
          userId,
        });
        return;
      }

      if (!data.usage) return;

      const messageId = resolveCommercialBillingReferenceId(metadata) ?? reservation?.operationId;
      if (!messageId) {
        console.warn('[billing] skip chat usage charge because no billing reference metadata', {
          model: payload.model,
          provider,
        });
        return;
      }

      const db = await getServerDB();
      await recordCommercialChatUsage({
        db,
        messageId,
        model: payload.model,
        operationId: getStringMetadataValue(metadata, 'operationId'),
        provider,
        routeMetadata,
        usage: data.usage,
        userId,
      });
    },
    onChatError: async (_error, { options, payload }) => {
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      await releaseReservation(payload, options?.metadata);
    },
    onTranscribeError: async (_error, { options, payload }) => {
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      await releaseReservation(payload, options?.metadata);
    },
    onTranscribeFinal: async (data, { options, payload }) => {
      const metadata = options?.metadata;
      if (shouldSkipCommercialBilling(metadata)) return;
      if (!data) {
        await releaseReservation(payload, metadata);
        return;
      }

      const reservation = resolveReservationContext(payload, metadata);
      reservationByPayload.delete(payload);
      if (!reservation?.reservationId) return;

      const db = await getServerDB();
      const actualCredits = await resolveCommercialAsrCredits({
        db,
        model: payload.model,
        payload,
        provider,
        routeMetadata,
        usage: data.usage,
        userId,
      });
      await settleCommercialAiUsageReservation({
        actualCredits,
        actualCreditsAreBase: true,
        db,
        estimatedCredits: reservation.estimatedCredits,
        model: payload.model,
        operationId: reservation.operationId,
        provider,
        pricingQuote: reservation.pricingQuote,
        reservationId: reservation.reservationId,
        routeMetadata,
        title: 'AI Transcription Usage',
        usageType: 'asr',
        userId,
      });
    },
    onEmbeddingsFinal: async (data, { options, payload }) => {
      const metadata = options?.metadata;
      if (shouldSkipCommercialBilling(metadata)) return;

      const reservation = resolveReservationContext(payload, metadata);
      reservationByPayload.delete(payload);
      if (reservation?.reservationId) {
        const db = await getServerDB();
        await settleCommercialAiUsageReservation({
          db,
          estimatedCredits: reservation.estimatedCredits,
          model: payload.model,
          operationId: reservation.operationId,
          provider,
          pricingQuote: reservation.pricingQuote,
          reservationId: reservation.reservationId,
          routeMetadata,
          title: 'AI Embeddings Usage',
          usage: data.usage,
          usageType: 'embeddings',
          userId,
        });
        return;
      }

      if (!data.usage) return;

      const referenceId =
        resolveCommercialBillingReferenceId(metadata) ??
        reservation?.operationId ??
        createBillingOperationId('embeddings');
      const db = await getServerDB();

      await recordCommercialAiUsage({
        db,
        model: payload.model,
        operationId: getStringMetadataValue(metadata, 'operationId'),
        provider,
        referenceId,
        referenceType: 'model_runtime_embeddings',
        routeMetadata,
        title: 'AI Embeddings Usage',
        usage: data.usage,
        usageType: 'embeddings',
        userId,
      });
    },
    onEmbeddingsError: async (_error, { options, payload }) => {
      if (shouldSkipCommercialBilling(options?.metadata)) return;
      await releaseReservation(payload, options?.metadata);
    },
    onGenerateObjectComplete: async (data, { options, payload }) => {
      const metadata = options?.metadata;
      if (shouldSkipCommercialBilling(metadata)) return;
      const reservation = resolveReservationContext(payload, metadata);
      reservationByPayload.delete(payload);
      if (!reservation?.reservationId) return;

      if (!data.success) {
        const db = await getServerDB();
        await releaseCommercialAiUsageReservation({
          db,
          reason: 'provider_error',
          reservationId: reservation.reservationId,
        });
        return;
      }

      const db = await getServerDB();
      await settleCommercialAiUsageReservation({
        db,
        estimatedCredits: reservation.estimatedCredits,
        model: payload.model,
        operationId: reservation.operationId,
        provider,
        pricingQuote: reservation.pricingQuote,
        reservationId: reservation.reservationId,
        routeMetadata,
        title: 'AI Structured Output Usage',
        usage: data.usage,
        usageType: 'generate_object',
        userId,
      });
    },
    onGenerateObjectFinal: async (data, { options, payload }) => {
      const metadata = options?.metadata;
      if (shouldSkipCommercialBilling(metadata)) return;
      if (!data.usage) return;

      const reservation = resolveReservationContext(payload, metadata);
      if (reservation?.reservationId) return;

      const referenceId =
        resolveCommercialBillingReferenceId(metadata) ??
        reservation?.operationId ??
        createBillingOperationId('generate_object');
      const db = await getServerDB();

      await recordCommercialAiUsage({
        db,
        model: payload.model,
        operationId: getStringMetadataValue(metadata, 'operationId'),
        provider,
        referenceId,
        referenceType: 'model_runtime_generate_object',
        routeMetadata,
        title: 'AI Structured Output Usage',
        usage: data.usage,
        usageType: 'generate_object',
        userId,
      });
    },
  };
}
