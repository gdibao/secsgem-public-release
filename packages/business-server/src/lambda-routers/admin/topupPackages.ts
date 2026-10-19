import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  normalizeTopUpPackagePromotion,
  serializeTopUpPackagePromotion,
} from '@/const/billingPresentation';
import { redemptionCodes, topUpPackages } from '@/database/schemas';
import { ADMIN_CAPABILITIES, adminCapabilityProcedure, router } from '@/libs/trpc/lambda';

import { runRequiredAdminAuditMutation } from './audit';

const PackageInputSchema = z.object({
  amount: z.number().min(0),
  credits: z.number().min(0),
  currency: z.string().max(16).default('USD'),
  displayName: z.string().min(1).max(200),
  id: z.string().min(1).max(64),
  isActive: z.boolean().default(true),
  originalAmount: z.number().min(0).optional(),
  promotionEnabled: z.boolean().optional(),
  promotionLabel: z.string().max(120).optional(),
  promotionNote: z.string().max(240).optional(),
  recommended: z.boolean().default(false),
  sortOrder: z.number().default(0),
  validityMonths: z.number().min(1).default(12),
});

const financeReadProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeRead);
const financeWriteProcedure = adminCapabilityProcedure(ADMIN_CAPABILITIES.financeWrite);

export const adminTopUpPackagesRouter = router({
  delete: financeWriteProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<void>(ctx, {
        audit: () => ({
          action: 'topupPackage.delete',
          resourceId: input.id,
          resourceType: 'topup_package',
        }),
        mutation: async (tx) => {
          const referencingCode = await tx.query.redemptionCodes.findFirst({
            columns: { id: true },
            where: eq(redemptionCodes.topupPackageId, input.id),
          });

          if (referencingCode) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'TOPUP_PACKAGE_HAS_REDEMPTION_CODES',
            });
          }

          await tx.delete(topUpPackages).where(eq(topUpPackages.id, input.id));
        },
      });
      return { ok: true };
    }),

  list: financeReadProcedure.query(async ({ ctx }) => {
    const items = await ctx.serverDB.query.topUpPackages.findMany({
      orderBy: asc(topUpPackages.sortOrder),
    });
    return { items };
  }),

  setActive: financeWriteProcedure
    .input(z.object({ id: z.string().min(1), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await runRequiredAdminAuditMutation<void>(ctx, {
        audit: () => ({
          action: 'topupPackage.setActive',
          payload: { isActive: input.isActive },
          resourceId: input.id,
          resourceType: 'topup_package',
        }),
        mutation: async (tx) => {
          const result = await tx
            .update(topUpPackages)
            .set({ isActive: input.isActive, updatedAt: new Date() })
            .where(eq(topUpPackages.id, input.id))
            .returning({ id: topUpPackages.id });

          if (result.length === 0)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
        },
      });
      return { ok: true };
    }),

  upsert: financeWriteProcedure.input(PackageInputSchema).mutation(async ({ ctx, input }) => {
    const { originalAmount, promotionEnabled, promotionLabel, promotionNote, ...packageInput } =
      input;
    await runRequiredAdminAuditMutation<any>(ctx, {
      audit: ({ existing, metadata }) => ({
        action: existing ? 'topupPackage.update' : 'topupPackage.create',
        payload: { ...packageInput, metadata },
        resourceId: packageInput.id,
        resourceType: 'topup_package',
      }),
      mutation: async (tx) => {
        const existing = await tx.query.topUpPackages.findFirst({
          where: eq(topUpPackages.id, packageInput.id),
        });
        const previousMetadata =
          existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
        const promotion = normalizeTopUpPackagePromotion({
          originalAmount,
          promotionEnabled,
          promotionLabel,
          promotionNote,
        });
        const metadata = {
          ...previousMetadata,
          ...serializeTopUpPackagePromotion(promotion),
        };

        if (existing) {
          await tx
            .update(topUpPackages)
            .set({ ...packageInput, metadata, updatedAt: new Date() })
            .where(eq(topUpPackages.id, packageInput.id));
        } else {
          await tx.insert(topUpPackages).values({ ...packageInput, metadata });
        }

        return { existing, metadata };
      },
    });
    return { ok: true };
  }),
});
