import { randomUUID } from 'node:crypto';

import { reserveCommercialAiUsage } from '@/business/server/commercialBilling';
import { estimateVideoCharge } from '@/business/server/generationBilling';
import { getServerModelPricing } from '@/business/server/serverModelPricing';
import { type AiUsageRouteMetadata } from '@/database/models/commercial';
import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';

const VIDEO_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

interface ChargeParams {
  db?: LobeChatDatabase;
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  userId: string;
  workspaceId?: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface VideoPrechargeResult extends Record<string, unknown> {
  costDetail?: {
    totalCost: number;
    totalCredits: number;
  };
  estimatedCredits?: number;
  operationId?: string;
  reservationId?: string;
  usageType?: 'video';
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: VideoPrechargeResult;
}

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  const {
    provider,
    userId,
    workspaceId,
    db,
    model,
    params: generationParams,
    routeMetadata,
  } = params;

  const pricing = await getServerModelPricing({ db, model, provider, type: 'video', userId });
  const { estimatedCredits, totalCost } = estimateVideoCharge(pricing, generationParams);
  const operationId = `video:${randomUUID()}`;
  const reservation = await reserveCommercialAiUsage({
    db: db!,
    estimatedCredits,
    model,
    operationId,
    provider,
    reservationTtlMs: VIDEO_RESERVATION_TTL_MS,
    routeMetadata,
    usageType: 'video',
    userId,
    workspaceId,
  });
  if (!reservation) return {};

  return {
    prechargeResult: {
      costDetail: { totalCost, totalCredits: reservation.amount },
      estimatedCredits: reservation.amount,
      operationId,
      ...((reservation.metadata as Record<string, unknown> | undefined)?.pricingQuote
        ? { pricingQuote: (reservation.metadata as any).pricingQuote }
        : {}),
      reservationId: reservation.id,
      usageType: 'video',
    },
  };
}
