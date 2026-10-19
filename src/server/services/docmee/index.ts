import { randomUUID } from 'node:crypto';

import { Plans, subscriptionEntitlementSnapshotSchema } from '@lobechat/types';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { CommercialModel } from '@/database/models/commercial';
import { CreditLotModel } from '@/database/models/commercial/creditLot';
import {
  appSettings,
  creditAccounts,
  creditLedgerEntries,
  planCatalog,
  pptUsageRecords,
  userPlanSnapshots,
} from '@/database/schemas';
import { type LobeChatDatabase, type Transaction } from '@/database/type';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import { decryptAppSettingSecret } from '@/server/services/appSettings/secrets';

import {
  type DocmeePlanCapability,
  type DocmeePptSettings,
  normalizeDocmeePlanCapability,
  normalizeDocmeePptSettings,
} from './config';

export type DocmeePptErrorCode =
  | 'PPT_DISABLED'
  | 'PPT_EVENT_INVALID'
  | 'PPT_FORBIDDEN_BY_PLAN'
  | 'PPT_NOT_CONFIGURED'
  | 'PPT_QUOTA_EXHAUSTED'
  | 'PPT_UPSTREAM_TOKEN_FAILED';

export class DocmeePptError extends Error {
  code: DocmeePptErrorCode;

  constructor(code: DocmeePptErrorCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

type DocmeeEventType = 'afterGenerate' | 'beforeDownload' | 'charge' | 'error' | 'pageChange';

type Availability = {
  capability: DocmeePlanCapability;
  dailyRemaining: null | number;
  dailyUsed: number;
  plan: Plans;
  remaining: null | number;
  settings: DocmeePptSettings;
  used: number;
};

const DOCMEE_SETTING_KEYS = Object.values(APP_SETTING_KEYS).filter((key) =>
  key.startsWith('docmee.ppt.'),
);

const TOKEN_LIMIT_FALLBACK = 999_999;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (value === undefined) return undefined;
  if (isRecord(value)) return value;

  return { value };
};

const mergeMetadata = (
  current: Record<string, unknown> | null | undefined,
  next: unknown,
): Record<string, unknown> | undefined => {
  const normalized = normalizeMetadata(next);
  if (!normalized) return current ?? undefined;

  return {
    ...current,
    ...normalized,
  };
};

const parseJsonSafely = async (response: Response) => {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DocmeePptError('PPT_UPSTREAM_TOKEN_FAILED', 'Docmee token response is not JSON');
  }
};

const extractToken = (payload: any): string | null => {
  if (typeof payload === 'string') return payload;
  if (typeof payload?.token === 'string') return payload.token;
  if (typeof payload?.data === 'string') return payload.data;
  if (typeof payload?.data?.token === 'string') return payload.data.token;
  if (typeof payload?.result?.token === 'string') return payload.result.token;

  return null;
};

export class DocmeePptService {
  constructor(private readonly params: { db: LobeChatDatabase; userId: string }) {}

  private get db() {
    return this.params.db;
  }

  private get userId() {
    return this.params.userId;
  }

  private readSettings = async (): Promise<DocmeePptSettings> => {
    const rows = await this.db.query.appSettings.findMany({
      where: inArray(appSettings.key, DOCMEE_SETTING_KEYS),
    });

    const raw = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    raw[APP_SETTING_KEYS.docmeePptApiKey] = await decryptAppSettingSecret(
      APP_SETTING_KEYS.docmeePptApiKey,
      raw[APP_SETTING_KEYS.docmeePptApiKey],
    );

    return normalizeDocmeePptSettings(raw);
  };

  private getCurrentPlanSnapshot = async () => {
    const now = new Date();
    return this.db.query.userPlanSnapshots.findFirst({
      orderBy: [desc(userPlanSnapshots.startedAt), desc(userPlanSnapshots.createdAt)],
      where: and(
        eq(userPlanSnapshots.userId, this.userId),
        eq(userPlanSnapshots.status, 'active'),
        or(isNull(userPlanSnapshots.endsAt), gte(userPlanSnapshots.endsAt, now)),
      ),
    });
  };

  private getPlanCapability = async () => {
    const snapshot = await this.getCurrentPlanSnapshot();
    const plan = snapshot?.plan ?? Plans.Free;
    const metadata = isRecord(snapshot?.metadata) ? snapshot.metadata : null;
    if (metadata && Object.hasOwn(metadata, 'entitlementSnapshot')) {
      const entitlement = subscriptionEntitlementSnapshotSchema.parse(metadata.entitlementSnapshot);
      return {
        capability:
          entitlement.version === 2
            ? {
                creditCost: entitlement.pptCreditCost,
                enabled: entitlement.pptEnabled,
                monthlyQuota: entitlement.pptMonthlyQuota,
              }
            : normalizeDocmeePlanCapability(entitlement.planMetadata),
        plan,
      };
    }
    const row = await this.db.query.planCatalog.findFirst({
      where: eq(planCatalog.plan, plan),
    });

    return { capability: normalizeDocmeePlanCapability(row?.metadata), plan };
  };

  private countGeneratedSince = async (start: Date) => {
    const rows = await this.db.query.pptUsageRecords.findMany({
      where: and(
        eq(pptUsageRecords.userId, this.userId),
        or(
          eq(pptUsageRecords.status, 'generated'),
          eq(pptUsageRecords.status, 'downloaded'),
          isNotNull(pptUsageRecords.chargedLedgerEntryId),
        ),
        gte(pptUsageRecords.createdAt, start),
      ),
    });

    return rows.length;
  };

  private countMonthlyGenerated = async () => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    return this.countGeneratedSince(start);
  };

  private countDailyGenerated = async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return this.countGeneratedSince(start);
  };

  private assertAvailable = async (): Promise<Availability> => {
    const settings = await this.readSettings();
    if (!settings.enabled) throw new DocmeePptError('PPT_DISABLED');
    if (!settings.apiKey) throw new DocmeePptError('PPT_NOT_CONFIGURED');

    const { capability, plan } = await this.getPlanCapability();
    if (!capability.enabled) throw new DocmeePptError('PPT_FORBIDDEN_BY_PLAN');

    const [used, dailyUsed] = await Promise.all([
      this.countMonthlyGenerated(),
      settings.dailyLimit ? this.countDailyGenerated() : Promise.resolve(0),
    ]);
    const remaining =
      capability.monthlyQuota === null ? null : Math.max(0, capability.monthlyQuota - used);
    const dailyRemaining =
      settings.dailyLimit === null ? null : Math.max(0, settings.dailyLimit - dailyUsed);

    if (remaining !== null && remaining <= 0) throw new DocmeePptError('PPT_QUOTA_EXHAUSTED');
    if (dailyRemaining !== null && dailyRemaining <= 0) {
      throw new DocmeePptError('PPT_QUOTA_EXHAUSTED');
    }

    return { capability, dailyRemaining, dailyUsed, plan, remaining, settings, used };
  };

  getRuntime = async () => {
    try {
      const { capability, dailyRemaining, dailyUsed, plan, remaining, settings, used } =
        await this.assertAvailable();

      return {
        allowPdfExport: settings.allowPdfExport,
        allowPptxDownload: settings.allowPptxDownload,
        baseUrl: settings.baseUrl,
        configured: Boolean(settings.apiKey),
        creatorVersion: settings.creatorVersion,
        dailyQuota: { limit: settings.dailyLimit, remaining: dailyRemaining, used: dailyUsed },
        enabled: settings.enabled,
        lang: settings.lang,
        plan,
        quota: { monthly: capability.monthlyQuota, remaining, used },
        themeColor: settings.themeColor,
      };
    } catch (error) {
      if (error instanceof DocmeePptError) {
        return {
          code: error.code,
          configured: error.code !== 'PPT_NOT_CONFIGURED',
          enabled: false,
        };
      }

      throw error;
    }
  };

  private assertCreditBalanceAvailable = async (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;

    await this.db.transaction(async (tx) => {
      await this.ensureCreditAccount(tx);
      const lotModel = new CreditLotModel(this.db, this.userId);
      await lotModel.expireDueLots(tx);
      await lotModel.assertNoOpenDebt(tx);
      const [account] = await tx
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, this.userId));

      if (!account || Number(account.balance) < amount) {
        throw new DocmeePptError('PPT_QUOTA_EXHAUSTED');
      }
    });
  };

  createToken = async (recordId?: string) => {
    const { capability, dailyRemaining, plan, remaining, settings } = await this.assertAvailable();
    const resumeRecord = recordId
      ? await this.db.query.pptUsageRecords.findFirst({
          where: and(
            eq(pptUsageRecords.id, recordId),
            eq(pptUsageRecords.userId, this.userId),
            isNotNull(pptUsageRecords.upstreamTaskId),
          ),
        })
      : undefined;

    if (recordId && !resumeRecord) throw new DocmeePptError('PPT_EVENT_INVALID');
    if (!resumeRecord) await this.assertCreditBalanceAvailable(capability.creditCost);

    const sessionId = resumeRecord?.sessionId ?? randomUUID();
    const docmeeUid = `comhub:${this.userId}`;
    const limit = Math.max(
      1,
      Math.min(remaining ?? TOKEN_LIMIT_FALLBACK, dailyRemaining ?? TOKEN_LIMIT_FALLBACK),
    );
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/api/user/createApiToken`, {
      body: JSON.stringify({ limit, uid: docmeeUid }),
      headers: {
        'Api-Key': settings.apiKey!,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new DocmeePptError('PPT_UPSTREAM_TOKEN_FAILED', `Docmee token HTTP ${response.status}`);
    }

    const payload = await parseJsonSafely(response);
    const token = extractToken(payload);

    if (!token) throw new DocmeePptError('PPT_UPSTREAM_TOKEN_FAILED', 'Docmee token missing');

    if (!resumeRecord) {
      await this.db
        .insert(pptUsageRecords)
        .values({
          creditCost: capability.creditCost,
          docmeeUid,
          metadata: {
            creatorVersion: settings.creatorVersion,
            tokenLimit: limit,
            tokenTtlMinutes: settings.tokenTtlMinutes,
          },
          plan,
          quotaCost: 1,
          sessionId,
          status: 'created',
          userId: this.userId,
        })
        .onConflictDoNothing();
    }

    return {
      expiresIn: settings.tokenTtlMinutes * 60,
      sessionId,
      token,
      ...(resumeRecord?.upstreamTaskId ? { upstreamTaskId: resumeRecord.upstreamTaskId } : {}),
    };
  };

  private ensureCreditAccount = async (db: LobeChatDatabase | Transaction) => {
    await db
      .insert(creditAccounts)
      .values({ userId: this.userId })
      .onConflictDoNothing({ target: creditAccounts.userId });
  };

  private chargeGeneration = async ({
    data,
    sessionId,
    upstreamTaskId,
  }: {
    data?: unknown;
    sessionId: string;
    upstreamTaskId?: string;
  }) =>
    this.db.transaction(async (tx) => {
      const metadata = normalizeMetadata(data);
      const existingLedger = await tx.query.creditLedgerEntries.findFirst({
        where: and(
          eq(creditLedgerEntries.userId, this.userId),
          eq(creditLedgerEntries.referenceType, 'ppt_generation'),
          eq(creditLedgerEntries.referenceId, sessionId),
          eq(creditLedgerEntries.type, 'consume'),
        ),
      });

      if (existingLedger) {
        await tx
          .update(pptUsageRecords)
          .set({
            chargedLedgerEntryId: existingLedger.id,
            status: 'generated',
            updatedAt: new Date(),
            ...(upstreamTaskId ? { upstreamTaskId } : {}),
          })
          .where(
            and(eq(pptUsageRecords.userId, this.userId), eq(pptUsageRecords.sessionId, sessionId)),
          );

        return { charged: false, ledgerEntryId: existingLedger.id };
      }

      const [lockedRecord] = await tx
        .select()
        .from(pptUsageRecords)
        .where(
          and(eq(pptUsageRecords.userId, this.userId), eq(pptUsageRecords.sessionId, sessionId)),
        )
        .for('update');

      let record = lockedRecord;

      if (!record) {
        const { capability, plan } = await this.getPlanCapability();
        const [created] = await tx
          .insert(pptUsageRecords)
          .values({
            creditCost: capability.creditCost,
            docmeeUid: `comhub:${this.userId}`,
            metadata,
            plan,
            quotaCost: 1,
            sessionId,
            status: 'generated',
            upstreamTaskId,
            userId: this.userId,
          })
          .returning();
        record = created;
      }

      if (record.chargedLedgerEntryId) {
        return { charged: false, ledgerEntryId: record.chargedLedgerEntryId };
      }

      const amount = Math.max(0, Number(record.creditCost ?? 0));
      if (amount <= 0) {
        await tx
          .update(pptUsageRecords)
          .set({
            completedAt: new Date(),
            status: 'generated',
            updatedAt: new Date(),
            ...(upstreamTaskId ? { upstreamTaskId } : {}),
          })
          .where(eq(pptUsageRecords.id, record.id));

        return { charged: false, ledgerEntryId: null };
      }

      await this.ensureCreditAccount(tx);
      const lotModel = new CreditLotModel(this.db, this.userId);
      await lotModel.expireDueLots(tx);
      await lotModel.assertNoOpenDebt(tx);
      const [account] = await tx
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, this.userId))
        .for('update');

      if (!account || Number(account.balance) < amount) {
        throw new DocmeePptError('PPT_QUOTA_EXHAUSTED');
      }

      const { allocations, creditLotAllocations } = await new CommercialModel(
        this.db,
        this.userId,
      ).allocateAndTrackCreditConsumption({
        accountBalance: Number(account.balance),
        amount,
        tx,
      });

      const [updatedAccount] = await tx
        .update(creditAccounts)
        .set({
          balance: sql`${creditAccounts.balance} - ${amount}`,
          totalDebited: sql`${creditAccounts.totalDebited} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(creditAccounts.userId, this.userId), gte(creditAccounts.balance, amount)))
        .returning({ balance: creditAccounts.balance });

      if (!updatedAccount) throw new DocmeePptError('PPT_QUOTA_EXHAUSTED');

      const [ledgerEntry] = await tx
        .insert(creditLedgerEntries)
        .values({
          amount: -amount,
          balanceAfter: updatedAccount?.balance ?? 0,
          description: 'Docmee PPT generation',
          metadata: mergeMetadata(metadata, {
            allocations,
            creditLotAllocations,
            upstreamTaskId,
          }),
          referenceId: sessionId,
          referenceType: 'ppt_generation',
          title: 'PPT Generation',
          type: 'consume',
          userId: this.userId,
        })
        .returning({ id: creditLedgerEntries.id });

      if (!ledgerEntry) throw new DocmeePptError('PPT_EVENT_INVALID');

      await tx
        .update(pptUsageRecords)
        .set({
          chargedLedgerEntryId: ledgerEntry.id,
          completedAt: new Date(),
          metadata: mergeMetadata(record.metadata, data),
          status: 'generated',
          updatedAt: new Date(),
          ...(upstreamTaskId ? { upstreamTaskId } : {}),
        })
        .where(eq(pptUsageRecords.id, record.id));

      return { charged: true, ledgerEntryId: ledgerEntry.id };
    });

  reportEvent = async ({
    data,
    sessionId,
    type,
    upstreamTaskId,
  }: {
    data?: unknown;
    sessionId: string;
    type: DocmeeEventType;
    upstreamTaskId?: string;
  }) => {
    if (!sessionId) throw new DocmeePptError('PPT_EVENT_INVALID');

    if (type === 'afterGenerate') {
      return this.chargeGeneration({ data, sessionId, upstreamTaskId });
    }

    await this.db.transaction(async (tx) => {
      const record = await tx.query.pptUsageRecords.findFirst({
        where: and(
          eq(pptUsageRecords.userId, this.userId),
          eq(pptUsageRecords.sessionId, sessionId),
        ),
      });

      const status =
        type === 'beforeDownload'
          ? record?.status === 'generated' || record?.chargedLedgerEntryId
            ? 'generated'
            : 'downloaded'
          : type === 'error'
            ? 'failed'
            : type === 'pageChange'
              ? 'editing'
              : 'created';

      await tx
        .update(pptUsageRecords)
        .set({
          metadata: mergeMetadata(record?.metadata, data),
          status,
          updatedAt: new Date(),
          ...(upstreamTaskId ? { upstreamTaskId } : {}),
        })
        .where(
          and(eq(pptUsageRecords.userId, this.userId), eq(pptUsageRecords.sessionId, sessionId)),
        );
    });

    return { charged: false, ledgerEntryId: null };
  };
}
