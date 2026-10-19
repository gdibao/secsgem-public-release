import { randomUUID } from 'node:crypto';

import { moduleAppOrderSnapshotSchema } from '@lobechat/types';
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';

import {
  moduleAppInstallations,
  moduleAppLicenses,
  moduleAppOrders,
  moduleAppPaymentAttempts,
  moduleAppPrices,
  moduleAppProducts,
  moduleApps,
  moduleAppSubscriptions,
  moduleAppVersions,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

const buildOrderSnapshot = (
  product: typeof moduleAppProducts.$inferSelect,
  price: typeof moduleAppPrices.$inferSelect,
  versionId: string,
) =>
  moduleAppOrderSnapshotSchema.parse({
    ...(price.billingPeriod ? { billingPeriod: price.billingPeriod } : {}),
    currency: price.currency,
    licenseScope: product.licenseScope,
    moduleMultiplier: String(product.metadata.moduleMultiplier ?? '1'),
    price: price.amount,
    productType: product.productType,
    ...(price.promotion ? { promotion: price.promotion } : {}),
    revenueShareRate: String(product.metadata.revenueShareRate ?? '0'),
    ...(typeof product.metadata.seatCount === 'number'
      ? { seatCount: product.metadata.seatCount }
      : {}),
    termsVersion: String(product.metadata.termsVersion ?? '1'),
    trialDays: price.trialDays,
    versionId,
  });

export class ModuleAppCommerceModel {
  constructor(private readonly db: LobeChatDatabase) {}

  private ensureInstallationInTransaction = async (
    tx: Transaction,
    order: typeof moduleAppOrders.$inferSelect,
  ) => {
    let versionId =
      typeof order.snapshot.versionId === 'string' ? order.snapshot.versionId : undefined;
    if (!versionId) {
      const app = await tx.query.moduleApps.findFirst({
        where: and(eq(moduleApps.id, order.appId), eq(moduleApps.status, 'published')),
      });
      versionId = app?.currentPublishedVersionId ?? undefined;
    }
    if (!versionId) throw new Error('MODULE_APP_PUBLISHED_VERSION_NOT_FOUND');
    const version = await tx.query.moduleAppVersions.findFirst({
      where: and(
        eq(moduleAppVersions.id, versionId),
        eq(moduleAppVersions.appId, order.appId),
        isNotNull(moduleAppVersions.publishedAt),
      ),
    });
    if (!version) throw new Error('MODULE_APP_PUBLISHED_VERSION_NOT_FOUND');

    const scopeType = order.workspaceId ? 'workspace' : 'personal';
    const existing = await tx.query.moduleAppInstallations.findFirst({
      where: and(
        eq(moduleAppInstallations.appId, order.appId),
        eq(moduleAppInstallations.scopeType, scopeType),
        order.workspaceId
          ? eq(moduleAppInstallations.workspaceId, order.workspaceId)
          : eq(moduleAppInstallations.userId, order.purchaserUserId),
      ),
    });
    const now = new Date();
    if (existing) {
      if (
        existing.status === 'installed' &&
        !existing.uninstalledAt &&
        existing.versionId === version.id
      ) {
        return;
      }
      await tx
        .update(moduleAppInstallations)
        .set({
          installedAt: now,
          status: 'installed',
          uninstalledAt: null,
          updatedAt: now,
          versionId: version.id,
        })
        .where(eq(moduleAppInstallations.id, existing.id));
      return;
    }

    const [created] = await tx
      .insert(moduleAppInstallations)
      .values({
        appId: order.appId,
        installedAt: now,
        scopeType,
        status: 'installed',
        userId: order.purchaserUserId,
        versionId: version.id,
        workspaceId: order.workspaceId,
      })
      .onConflictDoNothing()
      .returning({ id: moduleAppInstallations.id });
    if (created) return;

    await tx
      .update(moduleAppInstallations)
      .set({
        installedAt: now,
        status: 'installed',
        uninstalledAt: null,
        updatedAt: now,
        versionId: version.id,
      })
      .where(
        and(
          eq(moduleAppInstallations.appId, order.appId),
          eq(moduleAppInstallations.scopeType, scopeType),
          order.workspaceId
            ? eq(moduleAppInstallations.workspaceId, order.workspaceId)
            : eq(moduleAppInstallations.userId, order.purchaserUserId),
          or(
            ne(moduleAppInstallations.status, 'installed'),
            isNotNull(moduleAppInstallations.uninstalledAt),
          ),
        ),
      );
  };

  settleOrderInTransaction = async (
    tx: Transaction,
    { orderId, paymentReference }: { orderId: string; paymentReference: string },
  ) => {
    const [order] = await tx
      .select()
      .from(moduleAppOrders)
      .where(eq(moduleAppOrders.id, orderId))
      .for('update');
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    if (order.status === 'paid') {
      if (order.paymentReference !== paymentReference) {
        throw new Error('MODULE_APP_ORDER_PAYMENT_CONFLICT');
      }
      await this.ensureInstallationInTransaction(tx, order);
      return order;
    }
    if (order.status !== 'pending') throw new Error('MODULE_APP_ORDER_NOT_SETTLEABLE');
    const now = new Date();
    const [paid] = await tx
      .update(moduleAppOrders)
      .set({ paidAt: now, paymentReference, status: 'paid', updatedAt: now })
      .where(eq(moduleAppOrders.id, orderId))
      .returning();
    if (!paid) throw new Error('MODULE_APP_ORDER_SETTLEMENT_FAILED');
    const billingPeriod = paid.snapshot.billingPeriod;
    const trialDays = Number(paid.snapshot.trialDays ?? 0);
    const isSubscription = paid.snapshot.productType === 'subscription';
    const trialEndsAt = trialDays > 0 ? new Date(now) : null;
    if (trialEndsAt) trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + trialDays);
    const periodStart = trialEndsAt ?? now;
    const periodEnd = new Date(periodStart);
    if (billingPeriod === 'monthly') periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    else if (billingPeriod === 'yearly') periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    const [license] = await tx
      .insert(moduleAppLicenses)
      .values({
        appId: paid.appId,
        endsAt: isSubscription ? periodEnd : null,
        licenseScope: String(paid.snapshot.licenseScope),
        orderId: paid.id,
        ownerUserId: paid.workspaceId ? null : paid.purchaserUserId,
        workspaceId: paid.workspaceId,
      })
      .returning();
    if (!license) throw new Error('MODULE_APP_LICENSE_CREATE_FAILED');
    if (isSubscription) {
      await tx.insert(moduleAppSubscriptions).values({
        currentPeriodEnd: periodEnd,
        currentPeriodStart: periodStart,
        licenseId: license.id,
        orderId: paid.id,
        status: trialDays > 0 ? 'trialing' : 'active',
        trialEndsAt,
      });
    }
    await this.ensureInstallationInTransaction(tx, paid);
    return paid;
  };

  refundOrderInTransaction = async (
    tx: Transaction,
    {
      actorUserId,
      orderId,
      reason,
      refundReference,
    }: { actorUserId: string; orderId: string; reason: string; refundReference: string },
  ) => {
    if (!actorUserId.trim() || !reason.trim()) throw new Error('MODULE_APP_REFUND_AUDIT_REQUIRED');
    const normalizedRefundReference = refundReference?.trim();
    if (!normalizedRefundReference) throw new Error('MODULE_APP_REFUND_REFERENCE_REQUIRED');
    const [existing] = await tx
      .select()
      .from(moduleAppOrders)
      .where(eq(moduleAppOrders.id, orderId))
      .for('update');
    if (!existing) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    if (existing.status === 'refunded') {
      if (existing.refundReference && existing.refundReference !== normalizedRefundReference) {
        throw new Error('MODULE_APP_REFUND_REFERENCE_CONFLICT');
      }
      if (existing.refundReference) return existing;

      const [updated] = await tx
        .update(moduleAppOrders)
        .set({ refundReference: normalizedRefundReference, updatedAt: new Date() })
        .where(eq(moduleAppOrders.id, orderId))
        .returning();
      return updated ?? existing;
    }
    if (existing.status !== 'paid') throw new Error('MODULE_APP_ORDER_NOT_REFUNDABLE');
    const now = new Date();
    const [order] = await tx
      .update(moduleAppOrders)
      .set({
        refundedAt: now,
        refundReference: normalizedRefundReference,
        status: 'refunded',
        updatedAt: now,
      })
      .where(eq(moduleAppOrders.id, orderId))
      .returning();
    if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
    await tx
      .update(moduleAppLicenses)
      .set({ revokedAt: now, status: 'revoked', updatedAt: now })
      .where(eq(moduleAppLicenses.orderId, orderId));
    await tx
      .update(moduleAppSubscriptions)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(moduleAppSubscriptions.orderId, orderId));
    return order;
  };

  createProduct = async (input: {
    appId: string;
    licenseScope: string;
    moduleMultiplier?: string;
    price: {
      amount: number;
      billingPeriod?: string;
      currency: string;
      promotion?: Record<string, unknown>;
      trialDays?: number;
    };
    productKey: string;
    productType: string;
    revenueShareRate?: string;
    seatCount?: number;
    termsVersion?: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [product] = await tx
        .insert(moduleAppProducts)
        .values({
          appId: input.appId,
          licenseScope: input.licenseScope,
          metadata: {
            moduleMultiplier: input.moduleMultiplier ?? '1',
            revenueShareRate: input.revenueShareRate ?? '0',
            ...(input.seatCount ? { seatCount: input.seatCount } : {}),
            termsVersion: input.termsVersion ?? '1',
          },
          productKey: input.productKey,
          productType: input.productType,
        })
        .returning();
      if (!product) throw new Error('MODULE_APP_PRODUCT_CREATE_FAILED');
      await tx.insert(moduleAppPrices).values({
        active: true,
        amount: input.price.amount,
        billingPeriod: input.price.billingPeriod,
        currency: input.price.currency,
        productId: product.id,
        promotion: input.price.promotion,
        trialDays: input.price.trialDays ?? 0,
      });
      return product;
    });

  listProducts = async ({ appId }: { appId: string }) =>
    this.db
      .select({
        amount: moduleAppPrices.amount,
        appId: moduleAppProducts.appId,
        billingPeriod: moduleAppPrices.billingPeriod,
        currency: moduleAppPrices.currency,
        licenseScope: moduleAppProducts.licenseScope,
        metadata: moduleAppProducts.metadata,
        priceId: moduleAppPrices.id,
        productId: moduleAppProducts.id,
        productKey: moduleAppProducts.productKey,
        productType: moduleAppProducts.productType,
        promotion: moduleAppPrices.promotion,
        status: moduleAppProducts.status,
        trialDays: moduleAppPrices.trialDays,
      })
      .from(moduleAppProducts)
      .innerJoin(
        moduleAppPrices,
        and(eq(moduleAppPrices.productId, moduleAppProducts.id), eq(moduleAppPrices.active, true)),
      )
      .where(eq(moduleAppProducts.appId, appId))
      .orderBy(desc(moduleAppProducts.createdAt));

  updateProduct = async (input: {
    licenseScope: string;
    moduleMultiplier?: string;
    price?: {
      amount: number;
      billingPeriod?: string;
      currency: string;
      promotion?: Record<string, unknown>;
      trialDays?: number;
    };
    productId: string;
    productType: string;
    revenueShareRate?: string;
    seatCount?: number;
    status: string;
    termsVersion?: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(moduleAppProducts)
        .where(eq(moduleAppProducts.id, input.productId))
        .for('update');
      if (!existing) throw new Error('MODULE_APP_PRODUCT_NOT_FOUND');

      const [product] = await tx
        .update(moduleAppProducts)
        .set({
          licenseScope: input.licenseScope,
          metadata: {
            ...existing.metadata,
            moduleMultiplier:
              input.moduleMultiplier ?? String(existing.metadata.moduleMultiplier ?? '1'),
            revenueShareRate:
              input.revenueShareRate ?? String(existing.metadata.revenueShareRate ?? '0'),
            ...(typeof input.seatCount === 'number' ? { seatCount: input.seatCount } : {}),
            termsVersion: input.termsVersion ?? String(existing.metadata.termsVersion ?? '1'),
          },
          productType: input.productType,
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(moduleAppProducts.id, input.productId))
        .returning();
      if (!product) throw new Error('MODULE_APP_PRODUCT_UPDATE_FAILED');

      let price: typeof moduleAppPrices.$inferSelect | undefined;
      if (input.price) {
        await tx
          .update(moduleAppPrices)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(eq(moduleAppPrices.productId, input.productId), eq(moduleAppPrices.active, true)),
          );
        [price] = await tx
          .insert(moduleAppPrices)
          .values({
            active: true,
            amount: input.price.amount,
            billingPeriod: input.price.billingPeriod,
            currency: input.price.currency,
            productId: input.productId,
            promotion: input.price.promotion,
            trialDays: input.price.trialDays ?? 0,
          })
          .returning();
        if (!price) throw new Error('MODULE_APP_PRICE_CREATE_FAILED');
      }

      return { price, product };
    });

  createOrder = async ({
    idempotencyKey = randomUUID(),
    productId,
    purchaserUserId,
    workspaceId,
  }: {
    idempotencyKey?: string;
    productId: string;
    purchaserUserId: string;
    workspaceId?: string;
  }) =>
    this.db.transaction(async (tx) => {
      const findIdempotentOrder = () =>
        tx.query.moduleAppOrders.findFirst({
          where: and(
            eq(moduleAppOrders.purchaserUserId, purchaserUserId),
            eq(moduleAppOrders.idempotencyKey, idempotencyKey),
          ),
        });
      const assertCompatibleOrder = (order: typeof moduleAppOrders.$inferSelect) => {
        if (order.productId !== productId || (order.workspaceId ?? undefined) !== workspaceId) {
          throw new Error('MODULE_APP_ORDER_IDEMPOTENCY_CONFLICT');
        }
        return order;
      };
      const existing = await findIdempotentOrder();
      if (existing) return assertCompatibleOrder(existing);

      const product = await tx.query.moduleAppProducts.findFirst({
        where: and(eq(moduleAppProducts.id, productId), eq(moduleAppProducts.status, 'active')),
      });
      const price = await tx.query.moduleAppPrices.findFirst({
        where: and(eq(moduleAppPrices.productId, productId), eq(moduleAppPrices.active, true)),
      });
      const app = product
        ? await tx.query.moduleApps.findFirst({
            where: and(eq(moduleApps.id, product.appId), eq(moduleApps.status, 'published')),
          })
        : null;
      if (!product || !price || !app) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
      if (!app.currentPublishedVersionId) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
      const version = await tx.query.moduleAppVersions.findFirst({
        where: and(
          eq(moduleAppVersions.id, app.currentPublishedVersionId),
          eq(moduleAppVersions.appId, app.id),
          isNotNull(moduleAppVersions.publishedAt),
        ),
      });
      if (!version) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
      if (product.licenseScope === 'personal' && workspaceId)
        throw new Error('MODULE_APP_WORKSPACE_FORBIDDEN');
      if (product.licenseScope !== 'personal' && !workspaceId)
        throw new Error('MODULE_APP_WORKSPACE_REQUIRED');
      const [order] = await tx
        .insert(moduleAppOrders)
        .values({
          appId: product.appId,
          idempotencyKey,
          priceId: price.id,
          productId,
          purchaserUserId,
          snapshot: buildOrderSnapshot(product, price, version.id),
          workspaceId,
        })
        .onConflictDoNothing({
          target: [moduleAppOrders.purchaserUserId, moduleAppOrders.idempotencyKey],
        })
        .returning();
      if (!order) {
        const concurrent = await findIdempotentOrder();
        if (!concurrent) throw new Error('MODULE_APP_ORDER_CREATE_FAILED');
        return assertCompatibleOrder(concurrent);
      }
      return order;
    });

  cancelOrder = async ({
    orderId,
    purchaserUserId,
  }: {
    orderId: string;
    purchaserUserId: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(moduleAppOrders)
        .where(
          and(
            eq(moduleAppOrders.id, orderId),
            eq(moduleAppOrders.purchaserUserId, purchaserUserId),
          ),
        )
        .for('update');
      if (!order) throw new Error('MODULE_APP_ORDER_NOT_FOUND');
      if (order.status === 'cancelled') return order;
      if (order.status !== 'pending') throw new Error('MODULE_APP_ORDER_NOT_CANCELLABLE');
      const activePaymentAttempt = await tx.query.moduleAppPaymentAttempts.findFirst({
        columns: { id: true },
        where: and(
          eq(moduleAppPaymentAttempts.orderId, order.id),
          inArray(moduleAppPaymentAttempts.status, ['created', 'pending']),
        ),
      });
      if (activePaymentAttempt) throw new Error('MODULE_APP_ORDER_PAYMENT_IN_PROGRESS');
      const now = new Date();
      const [cancelled] = await tx
        .update(moduleAppOrders)
        .set({ cancelledAt: now, status: 'cancelled', updatedAt: now })
        .where(eq(moduleAppOrders.id, order.id))
        .returning();
      if (!cancelled) throw new Error('MODULE_APP_ORDER_CANCEL_FAILED');
      return cancelled;
    });

  listCatalog = async ({ appId }: { appId?: string } = {}) =>
    this.db
      .select({
        amount: moduleAppPrices.amount,
        appId: moduleAppProducts.appId,
        billingPeriod: moduleAppPrices.billingPeriod,
        currency: moduleAppPrices.currency,
        licenseScope: moduleAppProducts.licenseScope,
        productId: moduleAppProducts.id,
        productKey: moduleAppProducts.productKey,
        productType: moduleAppProducts.productType,
        promotion: moduleAppPrices.promotion,
        trialDays: moduleAppPrices.trialDays,
      })
      .from(moduleAppProducts)
      .innerJoin(moduleAppPrices, eq(moduleAppPrices.productId, moduleAppProducts.id))
      .innerJoin(moduleApps, eq(moduleApps.id, moduleAppProducts.appId))
      .where(
        and(
          eq(moduleApps.status, 'published'),
          isNotNull(moduleApps.currentPublishedVersionId),
          eq(moduleAppProducts.status, 'active'),
          eq(moduleAppPrices.active, true),
          appId ? eq(moduleAppProducts.appId, appId) : undefined,
        ),
      );

  listOrders = async ({
    limit = 50,
    purchaserUserId,
  }: {
    limit?: number;
    purchaserUserId: string;
  }) =>
    this.db.query.moduleAppOrders.findMany({
      limit: Math.max(1, Math.min(100, Math.floor(limit))),
      orderBy: desc(moduleAppOrders.createdAt),
      where: eq(moduleAppOrders.purchaserUserId, purchaserUserId),
    });

  quoteProduct = async ({ productId }: { productId: string }) => {
    const product = await this.db.query.moduleAppProducts.findFirst({
      where: and(eq(moduleAppProducts.id, productId), eq(moduleAppProducts.status, 'active')),
    });
    const price = await this.db.query.moduleAppPrices.findFirst({
      where: and(eq(moduleAppPrices.productId, productId), eq(moduleAppPrices.active, true)),
    });
    const app = product
      ? await this.db.query.moduleApps.findFirst({
          where: and(eq(moduleApps.id, product.appId), eq(moduleApps.status, 'published')),
        })
      : null;
    if (!product || !price || !app) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
    if (!app.currentPublishedVersionId) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
    const version = await this.db.query.moduleAppVersions.findFirst({
      where: and(
        eq(moduleAppVersions.id, app.currentPublishedVersionId),
        eq(moduleAppVersions.appId, app.id),
        isNotNull(moduleAppVersions.publishedAt),
      ),
    });
    if (!version) throw new Error('MODULE_APP_PRODUCT_NOT_PURCHASABLE');
    return buildOrderSnapshot(product, price, version.id);
  };

  settleOrder = async ({
    orderId,
    paymentReference,
  }: {
    orderId: string;
    paymentReference: string;
  }) =>
    this.db.transaction((tx) => this.settleOrderInTransaction(tx, { orderId, paymentReference }));

  resolveLicense = async ({
    appId,
    userId,
    workspaceId,
  }: {
    appId: string;
    userId?: string;
    workspaceId?: string;
  }) => {
    if ((!userId && !workspaceId) || (userId && workspaceId))
      throw new Error('MODULE_APP_LICENSE_SCOPE_INVALID');
    return (
      (await this.db.query.moduleAppLicenses.findFirst({
        where: and(
          eq(moduleAppLicenses.appId, appId),
          userId
            ? eq(moduleAppLicenses.ownerUserId, userId)
            : eq(moduleAppLicenses.workspaceId, workspaceId!),
          eq(moduleAppLicenses.status, 'active'),
          isNull(moduleAppLicenses.revokedAt),
          or(isNull(moduleAppLicenses.endsAt), gt(moduleAppLicenses.endsAt, new Date())),
        ),
      })) ?? null
    );
  };

  resolveEntitlementContext = async ({
    appId,
    userId,
    workspaceId,
  }: {
    appId: string;
    userId?: string;
    workspaceId?: string;
  }) => {
    if ((!userId && !workspaceId) || (userId && workspaceId)) {
      throw new Error('MODULE_APP_LICENSE_SCOPE_INVALID');
    }

    const productScope = workspaceId
      ? ne(moduleAppProducts.licenseScope, 'personal')
      : eq(moduleAppProducts.licenseScope, 'personal');
    const [activeLicense, freeProduct, latestProduct] = await Promise.all([
      this.resolveLicense({ appId, userId, workspaceId }),
      this.db.query.moduleAppProducts.findFirst({
        orderBy: desc(moduleAppProducts.createdAt),
        where: and(
          eq(moduleAppProducts.appId, appId),
          eq(moduleAppProducts.productType, 'free'),
          eq(moduleAppProducts.status, 'active'),
          productScope,
        ),
      }),
      this.db.query.moduleAppProducts.findFirst({
        orderBy: desc(moduleAppProducts.createdAt),
        where: and(
          eq(moduleAppProducts.appId, appId),
          eq(moduleAppProducts.status, 'active'),
          productScope,
        ),
      }),
    ]);
    const product = freeProduct ?? latestProduct;
    const license =
      activeLicense ??
      (await this.db.query.moduleAppLicenses.findFirst({
        orderBy: desc(moduleAppLicenses.createdAt),
        where: and(
          eq(moduleAppLicenses.appId, appId),
          userId
            ? eq(moduleAppLicenses.ownerUserId, userId)
            : eq(moduleAppLicenses.workspaceId, workspaceId!),
        ),
      }));
    const order = license
      ? await this.db.query.moduleAppOrders.findFirst({
          where: eq(moduleAppOrders.id, license.orderId),
        })
      : null;
    const productType = String(order?.snapshot.productType ?? product?.productType ?? '');
    const normalizedProductType: 'free' | 'one_time' | 'subscription' | undefined =
      productType === 'free' || productType === 'one_time' || productType === 'subscription'
        ? productType
        : undefined;
    if (!license) return { license: null, productType: normalizedProductType };

    const now = new Date();
    const status: 'active' | 'expired' | 'revoked' =
      license.status === 'revoked' || license.revokedAt
        ? 'revoked'
        : license.status === 'expired' || (license.endsAt && license.endsAt <= now)
          ? 'expired'
          : 'active';
    const source: 'purchase' | 'trial' =
      Number(order?.snapshot.trialDays ?? 0) > 0 ? 'trial' : 'purchase';

    return {
      license: {
        ...license,
        source,
        status,
      },
      productType: normalizedProductType,
    };
  };

  refundOrder = async ({
    actorUserId,
    orderId,
    reason,
    refundReference,
  }: {
    actorUserId: string;
    orderId: string;
    reason: string;
    refundReference: string;
  }) =>
    this.db.transaction((tx) =>
      this.refundOrderInTransaction(tx, { actorUserId, orderId, reason, refundReference }),
    );
}
