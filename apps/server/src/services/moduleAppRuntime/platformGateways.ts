import { createHash } from 'node:crypto';

import {
  type ModuleAppAiChatResult,
  type ModuleAppAiModelList,
  type ModuleAppPaymentCatalog,
  moduleAppPaymentCatalogSchema,
  type ModuleAppPaymentCheckoutResult,
  type ModuleAppPaymentOrderStatusResult,
  moduleAppPaymentOrderStatusResultSchema,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { ModuleAppPaymentService } from '@/business/server/module-apps/payments/service';
import {
  ModuleAppAiGateway,
  type ModuleAppAiGatewayAdapter,
} from '@/business/server/module-apps/sdk/ai';
import type { ModuleAppGatewayContext } from '@/business/server/module-apps/sdk/context';
import {
  ModuleAppPaymentsGateway,
  type ModuleAppPaymentsGatewayAdapter,
} from '@/business/server/module-apps/sdk/payments';
import { isModelAllowedByPlanRules, resolvePlanModelRules } from '@/business/server/planModelRules';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import { ModuleAppPaymentModel } from '@/database/models/moduleAppPayment';
import { moduleAppOrders } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createModuleAppTextGenerator } from '@/server/services/moduleAppAi';
import { getAllEnabledModels } from '@/server/services/newapiInstance';
import {
  buildPaymentCallbackUrl,
  buildPaymentReturnUrl,
  getServerPaymentConfig,
  listCheckoutPaymentMethods,
  resolvePaymentMethod,
} from '@/server/services/payments/config';
import { createPaymentAdapter } from '@/server/services/payments/factory';

const normalizeTokenCount = (value: unknown) => {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, count);
};

const sdkIdempotencyKey = (installationId: string, requestId: string) =>
  `sdk:${createHash('sha256').update(`${installationId}:${requestId}`).digest('hex')}`;

const assertWorkspaceCheckoutAccess = (context: ModuleAppGatewayContext) => {
  if (context.scopeType !== 'workspace') return;
  if (context.workspaceRole === 'owner' || context.workspaceRole === 'admin') return;
  throw new Error('MODULE_APP_WORKSPACE_ADMIN_REQUIRED');
};

type ModuleAppRollout = { appIds: string[]; publisherIds: string[] };

export const createModuleAppAiGatewayAdapter = (
  db: LobeChatDatabase,
): ModuleAppAiGatewayAdapter => ({
  chat: async ({ capability, context, input, requestId }): Promise<ModuleAppAiChatResult> => {
    const generated = await createModuleAppTextGenerator({
      db,
      workspaceId: context.workspaceId ?? undefined,
    })({
      actionMultiplier: 1,
      appMultiplier: context.billing?.defaultMultiplier ?? 1,
      chargeAiUsage: true,
      idempotencyKey: sdkIdempotencyKey(context.installationId, requestId),
      maxTokens: input.maxTokens,
      messages: input.messages,
      model: input.model,
      provider: 'newapi',
      temperature: input.temperature,
      userId: capability.userId,
    });

    return {
      actualAiCredits: generated.actualAiCredits,
      model: input.model,
      text: generated.text,
      tokenUsage: {
        input: normalizeTokenCount(generated.tokenUsage?.input),
        output: normalizeTokenCount(generated.tokenUsage?.output),
        total: normalizeTokenCount(generated.tokenUsage?.total),
      },
    };
  },

  listModels: async ({ capability }): Promise<ModuleAppAiModelList> => {
    const [rules, models] = await Promise.all([
      resolvePlanModelRules({ db, userId: capability.userId }),
      getAllEnabledModels(db),
    ]);
    const seen = new Set<string>();
    const available: ModuleAppAiModelList = [];

    for (const model of models) {
      if (model.type !== 'chat') continue;
      if (!isModelAllowedByPlanRules(rules, model.id, 'chat', model.groupKey)) continue;
      if (seen.has(model.id)) continue;
      seen.add(model.id);

      available.push({
        abilities: Object.entries(model.abilities ?? {})
          .filter(([, enabled]) => enabled)
          .map(([ability]) => ability),
        ...(model.displayName ? { displayName: model.displayName } : {}),
        id: model.id,
        type: 'chat',
      });
    }

    return available;
  },
});

export const createModuleAppPaymentsGatewayAdapter = (
  db: LobeChatDatabase,
  rollout: ModuleAppRollout,
): ModuleAppPaymentsGatewayAdapter => ({
  createCheckout: async ({
    capability,
    context,
    input,
  }): Promise<ModuleAppPaymentCheckoutResult> => {
    assertWorkspaceCheckoutAccess(context);
    const commerce = new ModuleAppCommerceModel(db);
    const catalog = await commerce.listCatalog({ appId: context.appId });
    const product = catalog.find((item) => item.productId === input.productId);
    if (!product) throw new Error('MODULE_APP_PRODUCT_NOT_FOUND');
    if (product.amount <= 0) throw new Error('MODULE_APP_PAYMENT_PRODUCT_FREE');
    if (
      (context.scopeType === 'personal' && product.licenseScope !== 'personal') ||
      (context.scopeType === 'workspace' && product.licenseScope === 'personal')
    ) {
      throw new Error('MODULE_APP_PAYMENT_SCOPE_DENIED');
    }

    const config = await getServerPaymentConfig(db);
    if (!config.enabled || !config.moduleAppEnabled) {
      throw new Error('MODULE_APP_PAYMENT_DISABLED');
    }
    if (!config.publicBaseUrl) throw new Error('MODULE_APP_PAYMENT_PUBLIC_URL_REQUIRED');

    const method = resolvePaymentMethod(config, 'module_app', input.method);
    const order = await commerce.createOrder({
      idempotencyKey: sdkIdempotencyKey(context.installationId, `payment:${input.idempotencyKey}`),
      productId: input.productId,
      purchaserUserId: capability.userId,
      workspaceId: context.workspaceId ?? undefined,
    });
    const payment = await new ModuleAppPaymentService(
      db,
      createPaymentAdapter(config, method.id),
    ).createPayment({
      notifyUrl: buildPaymentCallbackUrl(config, method.provider),
      orderId: order.id,
      purchaserUserId: capability.userId,
      returnUrl: buildPaymentReturnUrl(config, 'module_app'),
      rollout,
    });

    return { ...payment, orderId: order.id };
  },

  getOrderStatus: async ({
    capability,
    context,
    input,
  }): Promise<ModuleAppPaymentOrderStatusResult> => {
    const order = await db.query.moduleAppOrders.findFirst({
      columns: { appId: true, id: true, status: true, workspaceId: true },
      where: and(
        eq(moduleAppOrders.id, input.orderId),
        eq(moduleAppOrders.purchaserUserId, capability.userId),
      ),
    });
    if (
      !order ||
      order.appId !== context.appId ||
      (order.workspaceId ?? undefined) !== (context.workspaceId ?? undefined)
    ) {
      throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    }
    const attempt = await new ModuleAppPaymentModel(db).getPaymentAttemptByOrderId(order.id);
    return moduleAppPaymentOrderStatusResultSchema.parse({
      method: attempt?.method ?? null,
      paymentStatus: attempt?.status ?? null,
      provider: attempt?.provider ?? null,
      status: order.status,
    });
  },

  listCatalog: async ({ context }): Promise<ModuleAppPaymentCatalog> => {
    const catalog = await new ModuleAppCommerceModel(db).listCatalog({ appId: context.appId });
    return moduleAppPaymentCatalogSchema.parse(
      catalog
        .filter((item) =>
          context.scopeType === 'personal'
            ? item.licenseScope === 'personal'
            : item.licenseScope !== 'personal',
        )
        .map((item) => ({
          amount: item.amount,
          ...(item.billingPeriod ? { billingPeriod: item.billingPeriod } : {}),
          currency: item.currency,
          licenseScope: item.licenseScope,
          productId: item.productId,
          productKey: item.productKey,
          productType: item.productType,
          trialDays: item.trialDays,
        })),
    );
  },

  listMethods: async () => {
    const config = await getServerPaymentConfig(db);
    return listCheckoutPaymentMethods(config, 'module_app');
  },
});

export const createModuleAppPlatformGateways = (params: {
  db: LobeChatDatabase;
  rollout: ModuleAppRollout;
}) => ({
  ai: new ModuleAppAiGateway(createModuleAppAiGatewayAdapter(params.db)),
  payments: new ModuleAppPaymentsGateway(
    createModuleAppPaymentsGatewayAdapter(params.db, params.rollout),
  ),
});
