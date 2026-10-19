import { type SpendOrigin } from '@lobechat/types';

import {
  applyCommercialPricingQuoteToCredits,
  isCommercialUsageReservationHandle,
  releaseCommercialAiUsageReservation,
  settleCommercialAiUsageReservation,
  shouldChargeCommercialUsage,
} from '@/business/server/commercialBilling';
import {
  resolveGenerationPricingMultiplier,
  resolveVideoChargeCreditResult,
} from '@/business/server/generationBilling';
import { getServerModelPricing } from '@/business/server/serverModelPricing';
import { type AiUsageRouteMetadata, CommercialModel } from '@/database/models/commercial';
import { getServerDB } from '@/database/server';
import { type LobeChatDatabase } from '@/database/type';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean; resolution?: string };
  db?: LobeChatDatabase;
  isError?: boolean;
  /** Total time from task submission to webhook callback (ms) */
  latency?: number;
  metadata: SpendOrigin & {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    routeMetadata?: AiUsageRouteMetadata;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const {
    computePriceParams,
    isError,
    metadata,
    model,
    prechargeResult,
    provider,
    usage,
    userId,
    workspaceId,
  } = params;

  if (!prechargeResult || Object.keys(prechargeResult).length === 0) return;

  const db = params.db ?? (await getServerDB());
  const reservation = isCommercialUsageReservationHandle(prechargeResult, 'video')
    ? prechargeResult
    : undefined;

  if (isError) {
    if (reservation) {
      await releaseCommercialAiUsageReservation({
        db,
        reason: 'video_generation_failed',
        reservationId: reservation.reservationId,
      });
    }
    return;
  }

  if (!reservation) {
    if (workspaceId) return;
    const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
    if (!shouldCharge) return;
  }

  const resolvedModel = model ?? metadata.modelId;
  const pricing = await getServerModelPricing({
    db,
    model: resolvedModel,
    provider,
    type: 'video',
    userId,
  });
  const chargeResult = resolveVideoChargeCreditResult({
    computePriceParams,
    prechargeResult,
    pricing,
    usage,
  });
  const multiplier = await resolveGenerationPricingMultiplier({
    db,
    model: resolvedModel,
    provider,
    routeMetadata: metadata.routeMetadata,
  });
  const effectiveCredits =
    chargeResult.source === 'precharge'
      ? chargeResult.credits
      : reservation?.pricingQuote
        ? applyCommercialPricingQuoteToCredits(chargeResult.credits, reservation.pricingQuote)
        : Math.ceil(chargeResult.credits * multiplier);

  if (reservation) {
    await settleCommercialAiUsageReservation({
      actualCredits: effectiveCredits,
      db,
      estimatedCredits: reservation.estimatedCredits,
      model: resolvedModel,
      operationId: reservation.operationId,
      provider,
      pricingQuote: reservation.pricingQuote,
      reservationId: reservation.reservationId,
      routeMetadata: metadata.routeMetadata,
      title: 'Video Generation',
      usageType: 'video',
      userId,
    });
    return;
  }

  if (effectiveCredits <= 0) return;

  const commercialModel = new CommercialModel(db, userId);

  await commercialModel.postCharge({
    credits: effectiveCredits,
    metadata: {
      asyncTaskId: metadata.asyncTaskId,
      batchId: metadata.generationBatchId,
      computePriceParams: params.computePriceParams,
      latency: params.latency,
      ...(metadata.routeMetadata ? { routeMetadata: metadata.routeMetadata } : {}),
      usage: params.usage,
    },
    model: resolvedModel,
    provider,
    referenceId: metadata.asyncTaskId,
    referenceType: 'video_generation',
    source: 'video',
    title: 'Video Generation',
    userId,
  });
}
