import { randomUUID } from 'node:crypto';

import { type SpendOrigin } from '@lobechat/types';
import debug from 'debug';

import {
  type CommercialUsageReservationHandle,
  releaseCommercialAiUsageReservation,
  reserveCommercialAiUsage,
} from '@/business/server/commercialBilling';
import { estimateImageCharge } from '@/business/server/generationBilling';
import { getServerModelPricing } from '@/business/server/serverModelPricing';
import { type AiUsageRouteMetadata } from '@/database/models/commercial';
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';

const log = debug('lobe-image-generation:billing');

const releaseReservations = async ({
  db,
  items,
  reason,
}: {
  db: LobeChatDatabase;
  items: CommercialUsageReservationHandle[];
  reason: string;
}) => {
  const results = await Promise.allSettled(
    items.map(({ reservationId }) =>
      releaseCommercialAiUsageReservation({ db, reason, reservationId }),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      log('Failed to release image reservation %s: %O', items[index].reservationId, result.reason);
    }
  });
};

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  db?: LobeChatDatabase;
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
  /**
   * Origin of the request, so an implementation that defers the charge to a
   * later async step can persist it and still attribute the final spend.
   */
  spendOrigin?: SpendOrigin;
  userId: string;
  workspaceId?: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    }
  | {
      /**
       * Opaque per-generation billing handles, threaded back to
       * `chargeAfterGenerate` via `asyncTask.metadata.precharge` (one entry per
       * generation). Stored verbatim; the router never reads their fields.
       */
      prechargeItems?: unknown[];
    };

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeResult> {
  const { imageNum, provider, userId, workspaceId, db, model, generationParams, routeMetadata } =
    params;

  const pricing = await getServerModelPricing({ db, model, provider, type: 'image', userId });
  const { estimatedCredits } = estimateImageCharge(pricing, generationParams, 1);
  const requestId = randomUUID();
  const prechargeItems: CommercialUsageReservationHandle[] = [];

  try {
    for (let index = 0; index < imageNum; index++) {
      const operationId = `image:${requestId}:${index}`;
      const reservation = await reserveCommercialAiUsage({
        db: db!,
        estimatedCredits,
        model,
        operationId,
        provider,
        routeMetadata,
        usageType: 'image',
        userId,
        workspaceId,
      });
      if (!reservation) {
        await releaseReservations({
          db: db!,
          items: prechargeItems,
          reason: 'image_reservation_not_required',
        });
        return undefined;
      }

      prechargeItems.push({
        estimatedCredits: reservation.amount,
        operationId,
        ...((reservation.metadata as Record<string, unknown> | undefined)?.pricingQuote
          ? { pricingQuote: (reservation.metadata as any).pricingQuote }
          : {}),
        reservationId: reservation.id,
        usageType: 'image',
      });
    }
  } catch (error) {
    await releaseReservations({
      db: db!,
      items: prechargeItems,
      reason: 'image_reservation_batch_failed',
    });
    throw error;
  }

  return { prechargeItems };
}
