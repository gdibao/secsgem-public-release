import { paymentMethodIdSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ModuleAppPaymentService } from '@/business/server/module-apps/payments/service';
import { ModuleAppCommerceModel } from '@/database/models/moduleAppCommerce';
import { ModuleAppPaymentModel } from '@/database/models/moduleAppPayment';
import { moduleAppOrders } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import {
  buildPaymentCallbackUrl,
  buildPaymentReturnUrl,
  getServerPaymentConfig,
  listCheckoutPaymentMethods,
  resolvePaymentMethod,
} from '@/server/services/payments/config';
import { createPaymentAdapter } from '@/server/services/payments/factory';

import {
  assertWorkspaceManagementPermission,
  getWorkspaceMembership,
  moduleAppProcedure,
} from './data';

const AppIdInputSchema = z.object({
  appId: z.string().uuid(),
});
const ModuleAppOrderListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});
const ProductIdInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  productId: z.string().uuid(),
  workspaceId: z.string().min(1).optional(),
});
const ProductQuoteInputSchema = ProductIdInputSchema.omit({ idempotencyKey: true });
const OrderIdInputSchema = z.object({ orderId: z.string().uuid() });
const ModuleAppPaymentInputSchema = OrderIdInputSchema.extend({
  method: paymentMethodIdSchema.optional(),
});
const ModuleAppCatalogInputSchema = z.object({ appId: z.string().uuid().optional() });
const ModuleAppLaunchInputSchema = AppIdInputSchema.extend({
  workspaceId: z.string().min(1).optional(),
});

export const moduleAppCommerceProcedures = {
  cancelOrder: moduleAppProcedure.input(OrderIdInputSchema).mutation(async ({ ctx, input }) => {
    return new ModuleAppCommerceModel(ctx.serverDB).cancelOrder({
      orderId: input.orderId,
      purchaserUserId: ctx.userId,
    });
  }),

  createOrder: moduleAppProcedure.input(ProductIdInputSchema).mutation(async ({ ctx, input }) => {
    if (input.workspaceId) {
      await assertWorkspaceManagementPermission({
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }
    return new ModuleAppCommerceModel(ctx.serverDB).createOrder({
      idempotencyKey: input.idempotencyKey,
      productId: input.productId,
      purchaserUserId: ctx.userId,
      workspaceId: input.workspaceId,
    });
  }),

  getPaymentMethods: moduleAppProcedure.query(async ({ ctx }) => {
    const config = await getServerPaymentConfig(ctx.serverDB);
    return listCheckoutPaymentMethods(config, 'module_app');
  }),

  getPaymentStatus: moduleAppProcedure.input(OrderIdInputSchema).query(async ({ ctx, input }) => {
    const order = await ctx.serverDB.query.moduleAppOrders.findFirst({
      columns: { id: true, status: true },
      where: and(
        eq(moduleAppOrders.id, input.orderId),
        eq(moduleAppOrders.purchaserUserId, ctx.userId),
      ),
    });
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'module_app_order_not_found' });
    const attempt = await new ModuleAppPaymentModel(ctx.serverDB).getPaymentAttemptByOrderId(
      order.id,
    );
    return {
      method: attempt?.method ?? null,
      paymentStatus: attempt?.status ?? null,
      provider: attempt?.provider ?? null,
      status: order.status,
    };
  }),

  createPayment: moduleAppProcedure
    .input(ModuleAppPaymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const config = await getServerPaymentConfig(ctx.serverDB);
      if (!config.enabled || !config.moduleAppEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_payment_disabled',
        });
      }
      let method;
      try {
        method = resolvePaymentMethod(config, 'module_app', input.method);
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message: 'module_app_payment_method_unavailable',
        });
      }
      if (!config.publicBaseUrl) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'module_app_payment_public_url_required',
        });
      }
      return new ModuleAppPaymentService(
        ctx.serverDB,
        createPaymentAdapter(config, method.id),
      ).createPayment({
        notifyUrl: buildPaymentCallbackUrl(config, method.provider),
        orderId: input.orderId,
        purchaserUserId: ctx.userId,
        returnUrl: buildPaymentReturnUrl(config, 'module_app'),
        rollout: {
          appIds: appEnv.MODULE_APP_RUNTIME_APP_ALLOWLIST,
          publisherIds: appEnv.MODULE_APP_PUBLISHER_ALLOWLIST,
        },
      });
    }),

  getLicense: moduleAppProcedure.input(ModuleAppLaunchInputSchema).query(async ({ ctx, input }) => {
    if (input.workspaceId) {
      const membership = await getWorkspaceMembership(ctx.serverDB, ctx.userId, input.workspaceId);
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'module_app_workspace_denied' });
      }
    }
    return new ModuleAppCommerceModel(ctx.serverDB).resolveLicense(
      input.workspaceId
        ? { appId: input.appId, workspaceId: input.workspaceId }
        : { appId: input.appId, userId: ctx.userId },
    );
  }),

  listCatalog: moduleAppProcedure
    .input(ModuleAppCatalogInputSchema)
    .query(async ({ ctx, input }) => {
      return new ModuleAppCommerceModel(ctx.serverDB).listCatalog(input);
    }),

  listOrders: moduleAppProcedure
    .input(ModuleAppOrderListInputSchema)
    .query(async ({ ctx, input }) => {
      return new ModuleAppCommerceModel(ctx.serverDB).listOrders({
        limit: input.limit,
        purchaserUserId: ctx.userId,
      });
    }),

  quoteProduct: moduleAppProcedure.input(ProductQuoteInputSchema).query(async ({ ctx, input }) => {
    return new ModuleAppCommerceModel(ctx.serverDB).quoteProduct(input);
  }),
};
