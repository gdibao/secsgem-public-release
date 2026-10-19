import { and, desc, eq, isNull, ne, type SQL } from 'drizzle-orm';

import type {
  HeterogeneousRuntimeSessionItem,
  HeterogeneousRuntimeTenantItem,
  PersistentHeterogeneousProvider,
} from '../schemas/heterogeneousRuntime';
import {
  heterogeneousRuntimeSessions,
  heterogeneousRuntimeTenants,
} from '../schemas/heterogeneousRuntime';
import type { LobeChatDatabase } from '../type';

export class HeterogeneousRuntimeOwnershipError extends Error {
  readonly code = 'HETEROGENEOUS_RUNTIME_OWNERSHIP_MISMATCH' as const;

  constructor(message = 'Official runtime identity is outside the authenticated Fab scope') {
    super(message);
    this.name = 'HeterogeneousRuntimeOwnershipError';
  }
}

export interface HeterogeneousRuntimeScope {
  provider: PersistentHeterogeneousProvider;
  userId: string;
  workspaceId?: string;
}

/** Server-only persistence for official runtime identities and native sessions. */
export class HeterogeneousRuntimeModel {
  constructor(private readonly db: LobeChatDatabase) {}

  private scopeWhere = (scope: HeterogeneousRuntimeScope): SQL =>
    and(
      eq(heterogeneousRuntimeTenants.userId, scope.userId),
      eq(heterogeneousRuntimeTenants.provider, scope.provider),
      scope.workspaceId
        ? eq(heterogeneousRuntimeTenants.workspaceId, scope.workspaceId)
        : isNull(heterogeneousRuntimeTenants.workspaceId),
    )!;

  findTenant = async (
    scope: HeterogeneousRuntimeScope,
  ): Promise<HeterogeneousRuntimeTenantItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(heterogeneousRuntimeTenants)
      .where(this.scopeWhere(scope))
      .limit(1);
    return row;
  };

  /**
   * Create the durable tenant aggregate once. Existing rows retain their
   * partition key so AUTH_SECRET rotation cannot orphan an official runtime.
   */
  ensureTenant = async (
    scope: HeterogeneousRuntimeScope & { partitionKey: string },
  ): Promise<HeterogeneousRuntimeTenantItem> => {
    const existing = await this.findTenant(scope);
    if (existing) return existing;

    const prefix = `heterogeneous/${scope.partitionKey}/${scope.provider}`;
    const [created] = await this.db
      .insert(heterogeneousRuntimeTenants)
      .values({
        partitionKey: scope.partitionKey,
        provider: scope.provider,
        stateRef: `${prefix}/state`,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        workspaceRef: `${prefix}/workspace`,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    const raced = await this.findTenant(scope);
    if (!raced) throw new HeterogeneousRuntimeOwnershipError('Runtime tenant key is already owned');
    return raced;
  };

  updateRuntimeReference = async (
    scope: HeterogeneousRuntimeScope,
    input: {
      credentialRef?: string | null;
      runtimeRef?: string | null;
      status?: string;
    },
  ): Promise<HeterogeneousRuntimeTenantItem> => {
    const [updated] = await this.db
      .update(heterogeneousRuntimeTenants)
      .set({ ...input, updatedAt: new Date() })
      .where(this.scopeWhere(scope))
      .returning();
    if (!updated) throw new HeterogeneousRuntimeOwnershipError('Runtime tenant is not registered');
    return updated;
  };

  assertSessionOwned = async (
    scope: HeterogeneousRuntimeScope,
    nativeSessionId: string,
  ): Promise<HeterogeneousRuntimeSessionItem> => {
    const tenant = await this.findTenant(scope);
    if (!tenant) throw new HeterogeneousRuntimeOwnershipError();

    const [session] = await this.db
      .select()
      .from(heterogeneousRuntimeSessions)
      .where(
        and(
          eq(heterogeneousRuntimeSessions.tenantId, tenant.id),
          eq(heterogeneousRuntimeSessions.nativeSessionId, nativeSessionId),
        ),
      )
      .limit(1);
    if (!session) throw new HeterogeneousRuntimeOwnershipError();
    return session;
  };

  findActiveTopicSession = async (
    scope: HeterogeneousRuntimeScope,
    topicId: string,
  ): Promise<HeterogeneousRuntimeSessionItem | undefined> => {
    const tenant = await this.findTenant(scope);
    if (!tenant) return undefined;
    const [session] = await this.db
      .select()
      .from(heterogeneousRuntimeSessions)
      .where(
        and(
          eq(heterogeneousRuntimeSessions.tenantId, tenant.id),
          eq(heterogeneousRuntimeSessions.topicId, topicId),
          eq(heterogeneousRuntimeSessions.status, 'active'),
        ),
      )
      .orderBy(desc(heterogeneousRuntimeSessions.updatedAt))
      .limit(1);
    return session;
  };

  bindSession = async (
    scope: HeterogeneousRuntimeScope & {
      nativeSessionId: string;
      nativeThreadId?: string;
      topicId: string;
    },
  ): Promise<HeterogeneousRuntimeSessionItem> => {
    const tenant = await this.findTenant(scope);
    if (!tenant) throw new HeterogeneousRuntimeOwnershipError('Runtime tenant is not registered');

    await this.db
      .update(heterogeneousRuntimeSessions)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(
        and(
          eq(heterogeneousRuntimeSessions.tenantId, tenant.id),
          eq(heterogeneousRuntimeSessions.topicId, scope.topicId),
          eq(heterogeneousRuntimeSessions.status, 'active'),
          ne(heterogeneousRuntimeSessions.nativeSessionId, scope.nativeSessionId),
        ),
      );

    const [bound] = await this.db
      .insert(heterogeneousRuntimeSessions)
      .values({
        nativeSessionId: scope.nativeSessionId,
        nativeThreadId: scope.nativeThreadId,
        status: 'active',
        tenantId: tenant.id,
        topicId: scope.topicId,
      })
      .onConflictDoUpdate({
        set: {
          nativeThreadId: scope.nativeThreadId,
          status: 'active',
          topicId: scope.topicId,
          updatedAt: new Date(),
        },
        target: [
          heterogeneousRuntimeSessions.tenantId,
          heterogeneousRuntimeSessions.nativeSessionId,
        ],
      })
      .returning();
    return bound;
  };
}
