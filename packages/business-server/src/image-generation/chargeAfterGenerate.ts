import { type ModelPricingContext } from '@lobechat/model-runtime';
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
  resolveImageChargeCredits,
} from '@/business/server/generationBilling';
import { getServerModelPricing } from '@/business/server/serverModelPricing';
import { type AiUsageRouteMetadata, CommercialModel } from '@/database/models/commercial';
import { getServerDB } from '@/database/server';
import { type LobeChatDatabase } from '@/database/type';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  db?: LobeChatDatabase;
  isError?: boolean;
  metadata: SpendOrigin & {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    routeMetadata?: AiUsageRouteMetadata;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  /** Opaque billing handle passed through from `asyncTask.metadata.precharge`. */
  prechargeResult?: unknown;
  pricingContext?: ModelPricingContext;
  provider: string;
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const { isError, metadata, provider, userId, workspaceId, modelUsage, metrics, prechargeResult } =
    params;
  const db = params.db ?? (await getServerDB());
  const reservation = isCommercialUsageReservationHandle(prechargeResult, 'image')
    ? prechargeResult
    : undefined;

  if (isError) {
    if (reservation) {
      await releaseCommercialAiUsageReservation({
        db,
        reason: 'image_generation_failed',
        reservationId: reservation.reservationId,
      });
    }
    return;
  }

  if (!reservation) {
    // Reservations are mandatory for workspace billing. A missing handle can only
    // be a pre-upgrade personal task or non-commercial provider execution.
    if (workspaceId) return;
    const shouldCharge = await shouldChargeCommercialUsage({ db, provider, userId });
    if (!shouldCharge) return;
  }

  const pricing = await getServerModelPricing({
    db,
    model: metadata.modelId,
    provider,
    type: 'image',
    userId,
  });
  const baseCredits = resolveImageChargeCredits({
    modelUsage,
    pricing,
  });
  const credits = reservation?.pricingQuote
    ? applyCommercialPricingQuoteToCredits(baseCredits, reservation.pricingQuote)
    : Math.ceil(
        baseCredits *
          (await resolveGenerationPricingMultiplier({
            db,
            model: metadata.modelId,
            provider,
            routeMetadata: metadata.routeMetadata,
          })),
      );

  if (reservation) {
    await settleCommercialAiUsageReservation({
      actualCredits: credits,
      db,
      estimatedCredits: reservation.estimatedCredits,
      model: metadata.modelId,
      operationId: reservation.operationId,
      provider,
      pricingQuote: reservation.pricingQuote,
      reservationId: reservation.reservationId,
      routeMetadata: metadata.routeMetadata,
      title: 'Image Generation',
      usageType: 'image',
      userId,
    });
    return;
  }

  if (credits <= 0) return;

  await new CommercialModel(db, userId).postCharge({
    credits,
    metadata: {
      asyncTaskId: metadata.asyncTaskId,
      batchId: metadata.generationBatchId,
      ...(metrics?.latency !== undefined ? { latency: metrics.latency } : {}),
      ...(modelUsage ? { modelUsage } : {}),
      ...(metadata.routeMetadata ? { routeMetadata: metadata.routeMetadata } : {}),
    },
    model: metadata.modelId,
    provider,
    referenceId: metadata.asyncTaskId,
    referenceType: 'image_generation',
    source: 'image',
    title: 'Image Generation',
    userId,
  });
}
