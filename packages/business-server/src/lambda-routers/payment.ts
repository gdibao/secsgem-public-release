import { paymentCreateResultSchema, paymentMethodIdSchema, Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { CommercialModel } from '@/database/models/commercial';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import {
  buildPaymentCallbackUrl,
  buildPaymentReturnUrl,
  createOperationalPaymentConfig,
  getServerPaymentConfig,
  listCheckoutPaymentMethods,
  resolvePaymentMethod,
} from '@/server/services/payments/config';
import { createPaymentAdapter } from '@/server/services/payments/factory';
import { SubscriptionPaymentService } from '@/server/services/payments/subscriptionPayment';
import { TopUpPaymentService } from '@/server/services/payments/topUpPayment';

const paymentProcedure = authedProcedure.use(serverDatabase);

const createPaymentInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  method: paymentMethodIdSchema.optional(),
  packageId: z.string().trim().min(1),
});

export const paymentRouter = router({
  createSubscriptionPaymentOrder: paymentProcedure
    .input(
      z.object({
        cycle: z.enum(['lifetime', 'monthly', 'one_time', 'yearly']),
        idempotencyKey: z.string().uuid(),
        method: paymentMethodIdSchema.optional(),
        plan: z.nativeEnum(Plans),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const config = await getServerPaymentConfig(ctx.serverDB);
      if (!config.enabled || !config.subscriptionEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SUBSCRIPTION_PAYMENT_DISABLED',
        });
      }
      if (!config.publicBaseUrl) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PAYMENT_PUBLIC_BASE_URL_REQUIRED',
        });
      }
      try {
        const method = resolvePaymentMethod(config, 'subscription', input.method);
        const adapter = createPaymentAdapter(config, method.id);
        const commercial = new CommercialModel(ctx.serverDB, ctx.userId);
        const { order } = await commercial.createSubscriptionPaymentOrder({
          cycle: input.cycle,
          idempotencyKey: input.idempotencyKey,
          method: method.id,
          plan: input.plan,
          provider: method.provider,
        });
        if (order.checkout) {
          if (!order.externalOrderId) {
            throw new Error('SUBSCRIPTION_PAYMENT_CHECKOUT_RECOVERY_REQUIRED');
          }
          return {
            ...paymentCreateResultSchema.parse({
              checkout: order.checkout,
              method: order.method,
              outTradeNo: order.externalOrderId,
              provider: order.provider,
            }),
            orderId: order.id,
          };
        }
        const outTradeNo = adapter.createOutTradeNo({
          orderId: order.id,
          purpose: 'subscription',
        });
        const bound = await commercial.bindSubscriptionPayment({
          externalOrderId: outTradeNo,
          orderId: order.id,
        });
        if (bound.order.checkout) {
          return {
            ...paymentCreateResultSchema.parse({
              checkout: bound.order.checkout,
              method: bound.order.method,
              outTradeNo,
              provider: bound.order.provider,
            }),
            orderId: order.id,
          };
        }
        if (!bound.claimed && method.id === 'wechat_pay') {
          throw new Error('SUBSCRIPTION_PAYMENT_CHECKOUT_RECOVERY_REQUIRED');
        }
        const created = paymentCreateResultSchema.parse(
          await adapter.create({
            currency: z.enum(['CNY', 'USD']).parse(order.currency),
            expiresAt: order.expiresAt.toISOString(),
            notifyUrl: buildPaymentCallbackUrl(config, method.provider),
            orderId: order.id,
            purpose: 'subscription',
            returnUrl: buildPaymentReturnUrl(config, 'subscription'),
            subject: `${order.snapshot.displayName} ${order.cycle}`.slice(0, 240),
            totalAmount: Number(order.amount).toFixed(6),
          }),
        );
        if (
          created.outTradeNo !== outTradeNo ||
          created.method !== method.id ||
          created.provider !== method.provider
        ) {
          throw new Error('SUBSCRIPTION_PAYMENT_CREATE_INVALID');
        }
        const stored = await commercial.storeSubscriptionPaymentCheckout({
          checkout: created.checkout,
          orderId: order.id,
        });
        return {
          ...paymentCreateResultSchema.parse({ ...created, checkout: stored.checkout }),
          orderId: order.id,
        };
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'SUBSCRIPTION_PAYMENT_CREATE_FAILED',
        });
      }
    }),

  createPaymentOrder: paymentProcedure
    .input(createPaymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const config = await getServerPaymentConfig(ctx.serverDB);
      if (!config.enabled || !config.topUpEnabled) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TOP_UP_PAYMENT_DISABLED' });
      }
      let method;
      try {
        method = resolvePaymentMethod(config, 'top_up', input.method);
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message: 'PAYMENT_METHOD_NOT_AVAILABLE',
        });
      }
      if (!config.publicBaseUrl) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PAYMENT_PUBLIC_BASE_URL_REQUIRED',
        });
      }
      let adapter;
      try {
        adapter = createPaymentAdapter(config, method.id);
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'PAYMENT_ADAPTER_INVALID',
        });
      }

      try {
        const commercial = new CommercialModel(ctx.serverDB, ctx.userId);
        const { order } = await commercial.createOnlineTopUpOrder({
          idempotencyKey: input.idempotencyKey,
          method: method.id,
          packageId: input.packageId,
          provider: method.provider,
        });
        if (order.checkout) {
          if (!order.externalOrderId) throw new Error('TOP_UP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED');
          return {
            ...paymentCreateResultSchema.parse({
              checkout: order.checkout,
              method: method.id,
              outTradeNo: order.externalOrderId,
              provider: method.provider,
            }),
            orderId: order.id,
          };
        }
        const outTradeNo = adapter.createOutTradeNo({ orderId: order.id, purpose: 'top_up' });
        const bound = await commercial.bindOnlineTopUpPayment({
          externalOrderId: outTradeNo,
          method: method.id,
          orderId: order.id,
          provider: method.provider,
        });
        if (bound.order.checkout) {
          return {
            ...paymentCreateResultSchema.parse({
              checkout: bound.order.checkout,
              method: method.id,
              outTradeNo,
              provider: method.provider,
            }),
            orderId: order.id,
          };
        }
        if (!bound.claimed && method.id === 'wechat_pay') {
          throw new Error('TOP_UP_PAYMENT_CHECKOUT_RECOVERY_REQUIRED');
        }
        const created = paymentCreateResultSchema.parse(
          await adapter.create({
            currency: z.enum(['CNY', 'USD']).parse(order.currency),
            ...(order.expiresAt ? { expiresAt: order.expiresAt.toISOString() } : {}),
            notifyUrl: buildPaymentCallbackUrl(config, method.provider),
            orderId: order.id,
            purpose: 'top_up',
            returnUrl: buildPaymentReturnUrl(config, 'top_up'),
            subject: `ComHub 算力充值 ${order.id.slice(0, 8).toUpperCase()}`,
            totalAmount: Number(order.amount).toFixed(6),
          }),
        );
        if (
          created.outTradeNo !== outTradeNo ||
          created.method !== method.id ||
          created.provider !== method.provider
        ) {
          throw new Error('TOP_UP_PAYMENT_CREATE_INVALID');
        }
        const stored = await commercial.storeOnlineTopUpCheckout({
          checkout: created.checkout,
          orderId: order.id,
        });
        return {
          ...paymentCreateResultSchema.parse({ ...created, checkout: stored.checkout }),
          orderId: order.id,
        };
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'TOP_UP_PAYMENT_CREATE_FAILED',
        });
      }
    }),

  getPaymentMethods: paymentProcedure.query(async ({ ctx }) => {
    const config = await getServerPaymentConfig(ctx.serverDB);
    return listCheckoutPaymentMethods(config, 'top_up');
  }),

  getSubscriptionPaymentMethods: paymentProcedure.query(async ({ ctx }) => {
    const config = await getServerPaymentConfig(ctx.serverDB);
    return listCheckoutPaymentMethods(config, 'subscription');
  }),

  recoverPaymentOrder: paymentProcedure
    .input(z.object({ idempotencyKey: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const config = createOperationalPaymentConfig(await getServerPaymentConfig(ctx.serverDB));
      const service = new TopUpPaymentService(ctx.serverDB, (provider, method) => {
        const adapter = createPaymentAdapter(config, method);
        if (adapter.provider !== provider) throw new Error('TOP_UP_PAYMENT_ADAPTER_MISMATCH');
        return adapter;
      });

      try {
        return await service.reconcilePayment({
          idempotencyKey: input.idempotencyKey,
          userId: ctx.userId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TOP_UP_PAYMENT_RECOVERY_FAILED';
        throw new TRPCError({
          cause: error,
          code: message === 'TOP_UP_PAYMENT_ORDER_NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
          message,
        });
      }
    }),

  recoverSubscriptionPaymentOrder: paymentProcedure
    .input(z.object({ idempotencyKey: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const config = createOperationalPaymentConfig(await getServerPaymentConfig(ctx.serverDB));
      const service = new SubscriptionPaymentService(ctx.serverDB, (provider, method) => {
        const adapter = createPaymentAdapter(config, method);
        if (adapter.provider !== provider) {
          throw new Error('SUBSCRIPTION_PAYMENT_ADAPTER_MISMATCH');
        }
        return adapter;
      });
      try {
        return await service.reconcilePayment({
          idempotencyKey: input.idempotencyKey,
          userId: ctx.userId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'SUBSCRIPTION_PAYMENT_RECOVERY_FAILED';
        throw new TRPCError({
          cause: error,
          code: message === 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
          message,
        });
      }
    }),

  getPaymentStatus: paymentProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const order = await new CommercialModel(ctx.serverDB, ctx.userId).getTopUpOrder(
        input.orderId,
      );
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'TOP_UP_ORDER_NOT_FOUND' });
      return {
        orderId: order.id,
        paidAt: order.paidAt ?? null,
        provider: order.provider ?? null,
        status: order.status,
      };
    }),

  getSubscriptionPaymentStatus: paymentProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const order = await new CommercialModel(ctx.serverDB, ctx.userId).getSubscriptionPaymentOrder(
        input.orderId,
      );
      if (!order) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'SUBSCRIPTION_PAYMENT_ORDER_NOT_FOUND',
        });
      }
      return {
        orderId: order.id,
        paidAt: order.paidAt ?? null,
        provider: order.provider,
        status: order.status,
      };
    }),
});
