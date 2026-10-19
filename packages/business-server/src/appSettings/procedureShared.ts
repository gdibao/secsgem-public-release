import { Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { appSettings, planCatalog } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure } from '@/libs/trpc/lambda';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { getAllEnabledModels } from '@/server/services/newapiInstance';

import { isModelAllowedByPlanRules } from '../planModelRules';

export const systemWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.systemWrite);
export const SETTING_KEYS = APP_SETTING_KEYS;
export const readSetting = async (db: any, key: string): Promise<unknown> => {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  return row?.value ?? null;
};
export const toString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback;
export type AppSettingDraft = Record<string, unknown>;
export type DefaultModelType = 'chat' | 'embedding' | 'image' | 'video';
export const settingDraftString = (settings: AppSettingDraft, key: string) =>
  typeof settings[key] === 'string' ? (settings[key] as string).trim() : '';
export const validateDefaultAgentModelUsability = async (
  db: LobeChatDatabase,
  settings: AppSettingDraft,
  options: {
    enforcePlanRules?: boolean;
    missingMessage?: string;
    modelKey?: string;
    modelType?: DefaultModelType;
    providerKey?: string;
    requireEnabledRoute?: boolean;
    typeMismatchMessage?: string;
  } = {},
): Promise<void> => {
  const modelKey = options.modelKey ?? SETTING_KEYS.defaultAgentModel;
  const providerKey = options.providerKey ?? SETTING_KEYS.defaultAgentProvider;
  const modelType = options.modelType ?? 'chat';
  const enforcePlanRules = options.enforcePlanRules ?? true;
  const requireEnabledRoute = options.requireEnabledRoute ?? false;
  const missingMessage = options.missingMessage ?? 'DEFAULT_MODEL_NOT_ENABLED';
  const typeMismatchMessage = options.typeMismatchMessage ?? 'DEFAULT_MODEL_TYPE_MISMATCH';
  const provider = settingDraftString(settings, providerKey);
  const model = settingDraftString(settings, modelKey);

  if (!provider || !model) {
    if (requireEnabledRoute && (provider || model)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: missingMessage,
      });
    }
    return;
  }

  const enabledModels = await getAllEnabledModels(db);
  const providerMatchedRoutes = enabledModels.filter(
    (item) =>
      item.providerId === provider ||
      item.instanceId === provider ||
      item.providerType === provider ||
      (provider === 'newapi' && !item.providerId),
  );

  if (providerMatchedRoutes.length > 0 || provider === 'newapi') {
    const matchedRoutes = providerMatchedRoutes.filter((item) => item.id === model);

    if (matchedRoutes.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: missingMessage,
      });
    }

    const typeMatchedRoutes = matchedRoutes.filter((item) => item.type === modelType);

    if (typeMatchedRoutes.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: typeMismatchMessage,
      });
    }

    if (enforcePlanRules) {
      const freePlan = await db.query.planCatalog.findFirst({
        where: eq(planCatalog.plan, Plans.Free),
      });
      const modelRules = freePlan?.modelRules;

      if (!modelRules) return;

      const isAllowedByAnyEnabledRoute = typeMatchedRoutes.some((item) =>
        isModelAllowedByPlanRules(modelRules, model, modelType, item.groupKey),
      );

      if (!isAllowedByAnyEnabledRoute) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN',
        });
      }
    }

    return;
  }

  if (requireEnabledRoute) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: missingMessage,
    });
  }

  if (!enforcePlanRules) return;

  const freePlan = await db.query.planCatalog.findFirst({
    where: eq(planCatalog.plan, Plans.Free),
  });
  const modelRules = freePlan?.modelRules;

  if (!modelRules) return;

  if (!isModelAllowedByPlanRules(modelRules, model, modelType)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'DEFAULT_MODEL_DENIED_BY_FREE_PLAN',
    });
  }
};
