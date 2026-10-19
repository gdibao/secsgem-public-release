import {
  CREDITS_PER_DOLLAR,
  DEFAULT_PRICING_CREDIT_MULTIPLIER,
  USD_TO_CNY,
} from '@lobechat/const/currency';
import {
  computeImageCost,
  computeVideoCost,
  type ImageGenerationParams,
  resolveImageSinglePrice,
  resolveVideoSinglePrice,
  type VideoGenerationParams,
} from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import {
  type AiUsageRouteMetadata,
  parseAiUsagePricingRules,
  resolveAiUsagePricing,
} from '@/database/models/commercial';
import { type LobeChatDatabase } from '@/database/type';
import { APP_SETTING_KEYS, getAppSettingValue } from '@/server/services/appSettings';

export interface GenerationChargeEstimate {
  estimatedCredits: number;
  totalCost: number;
}

const usdToCredits = (usd: number) => {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * CREDITS_PER_DOLLAR);
};

export const resolveGenerationPricingMultiplier = async ({
  db,
  model,
  provider,
  routeMetadata,
}: {
  db?: LobeChatDatabase;
  model: string;
  provider: string;
  routeMetadata?: AiUsageRouteMetadata;
}) => {
  if (!db) return DEFAULT_PRICING_CREDIT_MULTIPLIER;

  const [globalMultiplierValue, modelRulesValue] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.pricingCreditMultiplier, db),
    getAppSettingValue(APP_SETTING_KEYS.pricingModelRules, db),
  ]);

  const globalMultiplier = Number(globalMultiplierValue);
  const rules = parseAiUsagePricingRules(modelRulesValue);

  return (
    resolveAiUsagePricing({
      globalMultiplier:
        Number.isFinite(globalMultiplier) && globalMultiplier > 0
          ? globalMultiplier
          : DEFAULT_PRICING_CREDIT_MULTIPLIER,
      groupKey: routeMetadata?.groupKey,
      groupMultiplier: routeMetadata?.groupMultiplier,
      instanceId: routeMetadata?.instanceId,
      model,
      provider,
      providerType: routeMetadata?.providerType,
      rules,
    }).multiplier ?? 1
  );
};

const resolveSingleImagePrice = (pricing?: Pricing) => {
  const singlePrice = resolveImageSinglePrice(pricing);
  if (singlePrice.price !== undefined) {
    return pricing?.currency === 'CNY' ? singlePrice.price / USD_TO_CNY : singlePrice.price;
  }
  return singlePrice.approximatePrice;
};

export const estimateImageCharge = (
  pricing: Pricing | undefined,
  params: ImageGenerationParams,
  imageNum: number,
): GenerationChargeEstimate => {
  const exactCost = pricing ? computeImageCost(pricing, params, imageNum) : undefined;
  if (exactCost) {
    return {
      estimatedCredits: exactCost.totalCredits,
      totalCost: exactCost.totalCost,
    };
  }

  const pricePerImage = resolveSingleImagePrice(pricing);
  if (typeof pricePerImage === 'number') {
    const totalCost = pricePerImage * imageNum;

    return {
      estimatedCredits: usdToCredits(totalCost),
      totalCost,
    };
  }

  return {
    estimatedCredits: imageNum * CREDITS_PER_DOLLAR,
    totalCost: imageNum,
  };
};

export const resolveImageChargeCredits = ({
  modelUsage,
  pricing,
}: {
  modelUsage?: ModelUsage;
  pricing?: Pricing;
}): number => {
  const usageCost = modelUsage?.cost;
  if (typeof usageCost === 'number' && Number.isFinite(usageCost)) {
    return usdToCredits(usageCost);
  }

  const pricePerImage = resolveSingleImagePrice(pricing);
  if (typeof pricePerImage === 'number') {
    return usdToCredits(pricePerImage);
  }

  return CREDITS_PER_DOLLAR;
};

export const estimateVideoCharge = (
  pricing: Pricing | undefined,
  _params: VideoGenerationParams,
): GenerationChargeEstimate => {
  const pricePerVideo = resolveVideoSinglePrice(pricing).approximatePrice;
  if (typeof pricePerVideo === 'number') {
    return {
      estimatedCredits: usdToCredits(pricePerVideo),
      totalCost: pricePerVideo,
    };
  }

  return {
    estimatedCredits: CREDITS_PER_DOLLAR,
    totalCost: 1,
  };
};

export const resolveVideoChargeCredits = ({
  computePriceParams,
  prechargeResult,
  pricing,
  usage,
}: {
  computePriceParams?: VideoGenerationParams;
  prechargeResult?: Record<string, unknown>;
  pricing?: Pricing;
  usage?: { completionTokens: number; totalTokens: number };
}): number => {
  return resolveVideoChargeCreditResult({ computePriceParams, prechargeResult, pricing, usage })
    .credits;
};

export type VideoChargeCreditSource = 'estimate' | 'precharge' | 'usage';

export const resolveVideoChargeCreditResult = ({
  computePriceParams,
  prechargeResult,
  pricing,
  usage,
}: {
  computePriceParams?: VideoGenerationParams;
  prechargeResult?: Record<string, unknown>;
  pricing?: Pricing;
  usage?: { completionTokens: number; totalTokens: number };
}): { credits: number; source: VideoChargeCreditSource } => {
  if (pricing && usage?.completionTokens !== undefined) {
    const exactCost = computeVideoCost(pricing, usage.completionTokens, computePriceParams ?? {});
    if (exactCost) {
      return { credits: exactCost.totalCredits, source: 'usage' };
    }
  }

  const prechargeCredits = (prechargeResult as any)?.costDetail?.totalCredits;
  if (Number.isFinite(prechargeCredits)) {
    return { credits: Number(prechargeCredits), source: 'precharge' };
  }

  if (Number.isFinite((prechargeResult as any)?.estimatedCredits)) {
    return { credits: Number((prechargeResult as any).estimatedCredits), source: 'precharge' };
  }

  const estimated = estimateVideoCharge(pricing, computePriceParams ?? {});
  return { credits: estimated.estimatedCredits, source: 'estimate' };
};
