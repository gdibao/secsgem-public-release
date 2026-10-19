import { randomUUID } from 'node:crypto';

import { type AuditEnvelopeStatus, createAuditEnvelope, redactAuditValue } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { adminAuditLogs } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

export type AdminAuditStatus = AuditEnvelopeStatus;
export type AdminAuditMode = 'best-effort' | 'required';
export type AdminAuditDatabase = LobeChatDatabase | Transaction;

export interface AuditEntry {
  action: string;
  payload?: Record<string, unknown>;
  resourceId?: string | null;
  resourceType?: string | null;
  targetUserId?: string | null;
}

export interface AuditContext {
  clientIp?: string | null;
  serverDB: AdminAuditDatabase;
  userId: string;
}

export type AdminAuditWriteResult = {
  correlationId: string;
  ok: boolean;
  status: AdminAuditStatus;
};

export type RecordAdminAuditOptions = {
  correlationId?: string;
  db?: AdminAuditDatabase;
  mode?: AdminAuditMode;
  status?: AdminAuditStatus;
};

export const LOW_RISK_BEST_EFFORT_ADMIN_AUDIT_ACTIONS = new Set([
  'newapiInstanceModels.refreshRuntimeCache',
  // L2-2 (docs/pilot/l2-audit-log-design.md): tool-open behavior audit is
  // low-risk, best-effort by design — audit failure must not block usage.
  'tool_open.embedded',
  'tool_open.external',
]);

export const redactAdminAuditValue = redactAuditValue;

export const createAdminAuditEnvelopePayload = ({
  action,
  actorUserId,
  clientIp,
  correlationId,
  payload,
  resourceId,
  resourceType,
  status,
  targetUserId,
}: {
  action: string;
  actorUserId: string;
  clientIp: null | string;
  correlationId: string;
  payload?: Record<string, unknown> | null;
  resourceId: null | string;
  resourceType: null | string;
  status: AdminAuditStatus;
  targetUserId: null | string;
}): Record<string, unknown> => ({
  ...createAuditEnvelope({
    audit: {
      action,
      actorUserId,
      clientIp,
      correlationId,
      resourceId,
      resourceType,
      status,
      targetUserId,
    },
    payload,
  }),
  correlationId,
  status,
});

const insertAdminAudit = async (
  db: AdminAuditDatabase,
  actorUserId: string,
  ipAddress: string | null,
  entry: AuditEntry,
  correlationId: string,
  status: AdminAuditStatus,
) => {
  await db.insert(adminAuditLogs).values({
    action: entry.action,
    actorUserId,
    ipAddress,
    payload: createAdminAuditEnvelopePayload({
      action: entry.action,
      actorUserId,
      clientIp: ipAddress,
      correlationId,
      payload: entry.payload,
      resourceId: entry.resourceId ?? null,
      resourceType: entry.resourceType ?? null,
      status,
      targetUserId: entry.targetUserId ?? null,
    }),
    resourceId: entry.resourceId ?? null,
    resourceType: entry.resourceType ?? null,
    targetUserId: entry.targetUserId ?? null,
  });
};

export async function recordAdminAudit(
  ctx: AuditContext,
  entry: AuditEntry,
  options?: RecordAdminAuditOptions,
): Promise<AdminAuditWriteResult>;
export async function recordAdminAudit(
  db: AdminAuditDatabase,
  actorUserId: string,
  entry: AuditEntry,
  options?: RecordAdminAuditOptions,
): Promise<AdminAuditWriteResult>;
export async function recordAdminAudit(
  ctxOrDb: AdminAuditDatabase | AuditContext,
  actorOrEntry: AuditEntry | string,
  entryOrOptions?: AuditEntry | RecordAdminAuditOptions,
  legacyOptions?: RecordAdminAuditOptions,
): Promise<AdminAuditWriteResult> {
  const isContextSignature = typeof actorOrEntry === 'object';
  const context = isContextSignature ? (ctxOrDb as AuditContext) : undefined;
  const entry = (isContextSignature ? actorOrEntry : entryOrOptions) as AuditEntry;
  const options = (isContextSignature ? entryOrOptions : legacyOptions) as
    RecordAdminAuditOptions | undefined;
  const actorUserId = isContextSignature ? context!.userId : (actorOrEntry as string);
  const correlationId = options?.correlationId ?? randomUUID();
  const db =
    options?.db ?? (isContextSignature ? context!.serverDB : (ctxOrDb as AdminAuditDatabase));
  const ipAddress = isContextSignature ? (context!.clientIp ?? null) : null;
  const mode = options?.mode ?? 'required';
  const status = options?.status ?? 'succeeded';

  if (mode === 'best-effort' && !LOW_RISK_BEST_EFFORT_ADMIN_AUDIT_ACTIONS.has(entry.action)) {
    throw new Error('ADMIN_AUDIT_BEST_EFFORT_NOT_ALLOWED');
  }

  try {
    await insertAdminAudit(db, actorUserId, ipAddress, entry, correlationId, status);
    return { correlationId, ok: true, status };
  } catch (error) {
    if (mode === 'required') throw error;

    console.error('[admin-audit] best-effort audit insert failed', {
      action: entry.action,
      correlationId,
      status,
    });
    return { correlationId, ok: false, status };
  }
}

export const recordAdminAuditStrict = async (
  ctx: AuditContext,
  entry: AuditEntry,
  options?: Omit<RecordAdminAuditOptions, 'mode'>,
) => recordAdminAudit(ctx, entry, { ...options, mode: 'required' });

export const runRequiredAdminAuditMutation = async <T>(
  ctx: Omit<AuditContext, 'serverDB'> & { serverDB: LobeChatDatabase },
  options: {
    audit: (result: T) => AuditEntry | Promise<AuditEntry>;
    correlationId?: string;
    mutation: (tx: Transaction) => Promise<T>;
  },
): Promise<T> => {
  const correlationId = options.correlationId ?? randomUUID();

  return ctx.serverDB.transaction(async (tx) => {
    const result = await options.mutation(tx);
    const entry = await options.audit(result);
    await recordAdminAudit({ ...ctx, serverDB: tx }, entry, {
      correlationId,
      mode: 'required',
      status: 'succeeded',
    });
    return result;
  });
};

const MAX_TERMINAL_AUDIT_ATTEMPTS = 3;

export class AdminAuditExternalEffectRecoveryError extends Error {
  readonly recoveryRequired = true;

  constructor(
    readonly details: {
      action: string;
      cause: unknown;
      correlationId: string;
      status: AdminAuditStatus;
    },
  ) {
    super('ADMIN_AUDIT_EXTERNAL_EFFECT_RECOVERY_REQUIRED');
    this.name = 'AdminAuditExternalEffectRecoveryError';
  }
}

const hasTerminalAdminAudit = async (
  db: AdminAuditDatabase,
  params: {
    action: string;
    correlationId: string;
    status: Exclude<AdminAuditStatus, 'started'>;
    terminalAuditId: string;
  },
) => {
  const existing = await db.query.adminAuditLogs.findFirst({
    columns: { payload: true },
    where: and(
      eq(adminAuditLogs.action, params.action),
      sql`${adminAuditLogs.payload}->>'correlationId' = ${params.correlationId}`,
      sql`${adminAuditLogs.payload}->>'status' = ${params.status}`,
      sql`${adminAuditLogs.payload}->>'terminalAuditId' = ${params.terminalAuditId}`,
    ),
  });

  const payload = existing?.payload;
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).terminalAuditId === params.terminalAuditId,
  );
};

const recordTerminalExternalEffectAudit = async <T>(
  ctx: AuditContext,
  options: {
    audit: (status: AdminAuditStatus, result?: T) => AuditEntry | Promise<AuditEntry>;
    correlationId: string;
  },
  status: Exclude<AdminAuditStatus, 'started'>,
  result?: T,
) => {
  let entry: AuditEntry;
  let lastError: unknown;

  try {
    entry = await options.audit(status, result);
  } catch (error) {
    return { action: 'unknown', error };
  }
  const terminalAuditId = randomUUID();
  const terminalEntry: AuditEntry = {
    ...entry,
    payload: { ...entry.payload, terminalAuditId },
  };

  for (let attempt = 1; attempt <= MAX_TERMINAL_AUDIT_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      try {
        if (
          await hasTerminalAdminAudit(ctx.serverDB, {
            action: entry.action,
            correlationId: options.correlationId,
            status,
            terminalAuditId,
          })
        ) {
          return { action: entry.action, error: null };
        }
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    try {
      await recordAdminAudit(ctx, terminalEntry, {
        correlationId: options.correlationId,
        mode: 'required',
        status,
      });
      return { action: entry.action, error: null };
    } catch (error) {
      lastError = error;
    }
  }

  return { action: entry.action, error: lastError };
};

const logExternalEffectRecoveryRequired = (params: {
  action: string;
  correlationId: string;
  status: Exclude<AdminAuditStatus, 'started'>;
}) => {
  console.error('[admin-audit] external effect terminal audit recovery required', {
    ...params,
    recoveryRequired: true,
  });
};

/**
 * Audits effects that cannot participate in a database transaction. The
 * durable `started` row is the gate; terminal audit rows describe the outcome,
 * but cannot roll an already executed external effect back.
 */
export const runRequiredAdminAuditExternalEffect = async <T>(
  ctx: AuditContext,
  options: {
    audit: (status: AdminAuditStatus, result?: T) => AuditEntry | Promise<AuditEntry>;
    correlationId?: string;
    effect: () => Promise<T>;
    terminalStatus?: (result: T) => Exclude<AdminAuditStatus, 'started'>;
  },
): Promise<T> => {
  const correlationId = options.correlationId ?? randomUUID();

  await recordAdminAudit(ctx, await options.audit('started'), {
    correlationId,
    mode: 'required',
    status: 'started',
  });

  let result: T;
  try {
    result = await options.effect();
  } catch (error) {
    const terminal = await recordTerminalExternalEffectAudit(
      ctx,
      { audit: options.audit, correlationId },
      'failed',
    );
    if (terminal.error) {
      logExternalEffectRecoveryRequired({
        action: terminal.action,
        correlationId,
        status: 'failed',
      });
    }
    throw error;
  }

  let terminalStatus: Exclude<AdminAuditStatus, 'started'>;
  try {
    terminalStatus = options.terminalStatus?.(result) ?? 'succeeded';
  } catch (error) {
    const terminal = await recordTerminalExternalEffectAudit(
      ctx,
      { audit: options.audit, correlationId },
      'failed',
      result,
    );
    logExternalEffectRecoveryRequired({
      action: terminal.action,
      correlationId,
      status: 'failed',
    });
    throw new AdminAuditExternalEffectRecoveryError({
      action: terminal.action,
      cause: terminal.error ?? error,
      correlationId,
      status: 'failed',
    });
  }
  const terminal = await recordTerminalExternalEffectAudit(
    ctx,
    { audit: options.audit, correlationId },
    terminalStatus,
    result,
  );
  if (terminal.error) {
    logExternalEffectRecoveryRequired({
      action: terminal.action,
      correlationId,
      status: terminalStatus,
    });
    throw new AdminAuditExternalEffectRecoveryError({
      action: terminal.action,
      cause: terminal.error,
      correlationId,
      status: terminalStatus,
    });
  }

  return result;
};
