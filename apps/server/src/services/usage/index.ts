import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import dayjs from 'dayjs';
import debug from 'debug';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { creditLedgerEntries, messages } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { notCopiedTranscript } from '@/database/utils/copiedTranscript';
import { genRangeWhere, genWhere } from '@/database/utils/genWhere';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { type MessageMetadata, type ModelUsage } from '@/types/message';
import {
  type AgentUsageBucket,
  type AgentUsageGranularity,
  type AgentUsageModelRow,
  type AgentUsageStats,
  type UsageLog,
  type UsageRecordItem,
} from '@/types/usage/usageRecord';
import { formatDate } from '@/utils/format';

import { computeMessageCostSplit } from './cost';

const log = debug('lobe-usage:service');

const BILLABLE_LEDGER_REFERENCE_TYPES = [
  'image_generation',
  'model_runtime_embeddings',
  'model_runtime_generate_object',
  'ppt_generation',
  'video_generation',
] as const;

type BillableLedgerReferenceType = (typeof BILLABLE_LEDGER_REFERENCE_TYPES)[number];
type BillableLedgerUsageType = 'embedding' | 'image' | 'ppt' | 'structured_output' | 'video';
type UnknownRecord = Record<string, unknown>;

export class UsageRecordService {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;
  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.db = db;
  }

  /**
   * @description Find usage records by date range.
   * @param agentId Optional agent id to attribute usage to a single agent.
   */
  findByDateRange = async (
    startAt: string,
    endAt: string,
    agentId?: string,
  ): Promise<UsageRecordItem[]> => {
    const spends = await this.db
      .select({
        createdAt: messages.createdAt,
        id: messages.id,
        metadata: messages.metadata,
        model: messages.model,
        provider: messages.provider,
        role: messages.role,
        updatedAt: messages.createdAt,
        usage: messages.usage,
        userId: messages.userId,
      })
      .from(messages)
      .where(
        genWhere([
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            { userId: messages.userId, workspaceId: messages.workspaceId },
          ),
          eq(messages.role, 'assistant'),
          notCopiedTranscript(),
          agentId ? eq(messages.agentId, agentId) : undefined,
          genRangeWhere([startAt, endAt], messages.createdAt, (date) => date.toDate()),
        ]),
      )
      .orderBy(desc(messages.createdAt));

    const ledgerUsageMap = await this.findAssistantMessageLedgerUsage(
      spends.map((spend) => spend.id),
    );

    const chatSpends = spends.map((spend) => {
      const metadata = spend.metadata as MessageMetadata | null;
      // Prefer the dedicated `usage` column, then the canonical nested
      // `metadata.usage` / `metadata.performance` shapes, falling back to the
      // deprecated flat fields for messages written before the migration.
      const usage = spend.usage ?? metadata?.usage;
      const performance = metadata?.performance;
      const usageCost = typeof usage?.cost === 'number' && usage.cost > 0 ? usage.cost : undefined;
      const metadataCost =
        typeof metadata?.cost === 'number' && metadata.cost > 0 ? metadata.cost : undefined;
      const ledgerUsage = ledgerUsageMap.get(spend.id);
      const totalInputTokens = usage?.totalInputTokens ?? metadata?.totalInputTokens ?? 0;
      const totalOutputTokens = usage?.totalOutputTokens ?? metadata?.totalOutputTokens ?? 0;

      return {
        createdAt: spend.createdAt,
        credits: ledgerUsage?.credits ?? 0,
        id: spend.id,
        metadata: spend.metadata,
        model: spend.model,
        provider: spend.provider,
        spend:
          usageCost ?? metadataCost ?? ledgerUsage?.spend ?? usage?.cost ?? metadata?.cost ?? 0,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        tps: performance?.tps ?? metadata?.tps ?? 0,
        ttft: performance?.ttft ?? metadata?.ttft ?? 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });

    const generationSpends = await this.findBillableLedgerUsage(startAt, endAt);

    return [...chatSpends, ...generationSpends].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  };

  private findAssistantMessageLedgerUsage = async (messageIds: string[]) => {
    if (messageIds.length === 0) return new Map<string, { credits: number; spend: number }>();

    const ledgerRows = await this.db
      .select({
        amount: creditLedgerEntries.amount,
        metadata: creditLedgerEntries.metadata,
        referenceId: creditLedgerEntries.referenceId,
      })
      .from(creditLedgerEntries)
      .where(
        and(
          eq(creditLedgerEntries.userId, this.userId),
          eq(creditLedgerEntries.type, 'consume'),
          eq(creditLedgerEntries.referenceType, 'assistant_message'),
          inArray(creditLedgerEntries.referenceId, messageIds),
        ),
      );

    const ledgerUsageMap = new Map<string, { credits: number; spend: number }>();
    for (const row of ledgerRows) {
      if (!row.referenceId) continue;

      const metadata = row.metadata ?? {};
      const credits = Math.abs(Number(row.amount) || 0);
      const usdCost = Number(metadata.usdCost);
      const fallbackCost = credits / CREDITS_PER_DOLLAR;
      const spend = Number.isFinite(usdCost) && usdCost > 0 ? usdCost : fallbackCost;
      const current = ledgerUsageMap.get(row.referenceId) ?? { credits: 0, spend: 0 };

      if (credits > 0 || spend > 0) {
        ledgerUsageMap.set(row.referenceId, {
          credits: current.credits + credits,
          spend: current.spend + spend,
        });
      }
    }

    return ledgerUsageMap;
  };

  private findBillableLedgerUsage = async (
    startAt: string,
    endAt: string,
  ): Promise<UsageRecordItem[]> => {
    const ledgerRows = await this.db
      .select({
        amount: creditLedgerEntries.amount,
        createdAt: creditLedgerEntries.createdAt,
        description: creditLedgerEntries.description,
        id: creditLedgerEntries.id,
        metadata: creditLedgerEntries.metadata,
        referenceId: creditLedgerEntries.referenceId,
        referenceType: creditLedgerEntries.referenceType,
        title: creditLedgerEntries.title,
        updatedAt: creditLedgerEntries.updatedAt,
        userId: creditLedgerEntries.userId,
      })
      .from(creditLedgerEntries)
      .where(
        genWhere([
          eq(creditLedgerEntries.userId, this.userId),
          eq(creditLedgerEntries.type, 'consume'),
          inArray(creditLedgerEntries.referenceType, [...BILLABLE_LEDGER_REFERENCE_TYPES]),
          genRangeWhere([startAt, endAt], creditLedgerEntries.createdAt, (date) => date.toDate()),
        ]),
      );

    return ledgerRows.map((row) =>
      this.mapBillableLedgerUsage({
        ...row,
        referenceType: row.referenceType as BillableLedgerReferenceType,
      }),
    );
  };

  private mapBillableLedgerUsage = (row: {
    amount: number;
    createdAt: Date;
    description: string | null;
    id: string;
    metadata: UnknownRecord | null;
    referenceId: string | null;
    referenceType: BillableLedgerReferenceType;
    title: string | null;
    updatedAt: Date;
    userId: string;
  }): UsageRecordItem => {
    const metadata = row.metadata ?? {};
    const type = this.resolveBillableLedgerUsageType(row.referenceType);
    const tokenUsage = this.resolveGenerationTokenUsage(type, metadata);

    return {
      createdAt: row.createdAt,
      credits: Math.abs(Number(row.amount) || 0),
      id: row.id || row.referenceId || `${row.referenceType}-${row.createdAt.getTime()}`,
      metadata: row.metadata as MessageMetadata | null,
      model: this.resolveGenerationModel(type, metadata, row.description, row.title),
      provider: this.resolveGenerationProvider(type, metadata),
      spend: Math.abs(Number(row.amount) || 0) / CREDITS_PER_DOLLAR,
      totalInputTokens: tokenUsage.totalInputTokens,
      totalOutputTokens: tokenUsage.totalOutputTokens,
      totalTokens: tokenUsage.totalTokens,
      tps: 0,
      ttft: 0,
      type,
      updatedAt: row.updatedAt,
      userId: row.userId,
    };
  };

  private resolveBillableLedgerUsageType = (
    referenceType: BillableLedgerReferenceType,
  ): BillableLedgerUsageType => {
    switch (referenceType) {
      case 'image_generation': {
        return 'image';
      }
      case 'model_runtime_embeddings': {
        return 'embedding';
      }
      case 'model_runtime_generate_object': {
        return 'structured_output';
      }
      case 'video_generation': {
        return 'video';
      }
      case 'ppt_generation': {
        return 'ppt';
      }
    }
  };

  private resolveGenerationProvider = (
    type: BillableLedgerUsageType,
    metadata: UnknownRecord,
  ): string => {
    if (type === 'ppt') return 'docmee';

    const routeMetadata = this.asRecord(metadata.routeMetadata);

    return (
      this.firstString(metadata, ['provider', 'providerId']) ??
      this.firstString(routeMetadata, ['providerType', 'instanceName', 'instanceId']) ??
      'generation'
    );
  };

  private resolveGenerationModel = (
    type: BillableLedgerUsageType,
    metadata: UnknownRecord,
    description: string | null,
    title: string | null,
  ): string => {
    if (type === 'ppt') return 'ppt';

    return (
      this.firstString(metadata, ['model', 'modelId']) ??
      this.parseModelFromDescription(description) ??
      title ??
      type
    );
  };

  private resolveGenerationTokenUsage = (
    type: BillableLedgerUsageType,
    metadata: UnknownRecord,
  ): Pick<UsageRecordItem, 'totalInputTokens' | 'totalOutputTokens' | 'totalTokens'> => {
    if (type === 'ppt') {
      return { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 };
    }

    const usage = this.asRecord(metadata.modelUsage) ?? this.asRecord(metadata.usage) ?? metadata;
    const totalOutputTokens =
      this.firstNumber(usage, ['totalOutputTokens', 'outputTokens', 'completionTokens']) ?? 0;
    const explicitInputTokens =
      this.firstNumber(usage, ['totalInputTokens', 'inputTokens', 'promptTokens']) ?? undefined;
    const explicitTotalTokens = this.firstNumber(usage, ['totalTokens']) ?? undefined;
    const totalInputTokens =
      explicitInputTokens ??
      (explicitTotalTokens === undefined
        ? 0
        : Math.max(explicitTotalTokens - totalOutputTokens, 0));
    const totalTokens = explicitTotalTokens ?? totalInputTokens + totalOutputTokens;

    return { totalInputTokens, totalOutputTokens, totalTokens };
  };

  private parseModelFromDescription = (description: string | null) => {
    if (!description) return;

    const marker = 'usage:';
    const markerIndex = description.toLowerCase().lastIndexOf(marker);

    if (markerIndex < 0) return;

    return description.slice(markerIndex + marker.length).trim() || undefined;
  };

  private asRecord = (value: unknown): UnknownRecord | undefined => {
    return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
  };

  private firstNumber = (record: UnknownRecord | undefined, keys: string[]) => {
    for (const key of keys) {
      const value = record?.[key];
      const numberValue = Number(value);

      if (Number.isFinite(numberValue)) return numberValue;
    }
  };

  private firstString = (record: UnknownRecord | undefined, keys: string[]) => {
    for (const key of keys) {
      const value = record?.[key];

      if (typeof value === 'string' && value.trim()) return value;
    }
  };

  /**
   * @description Find usage records by month.
   * @param mo Month
   * @param agentId When provided, only count messages produced by this agent.
   * @returns UsageRecordItem[]
   */
  findByMonth = async (mo?: string, agentId?: string): Promise<UsageRecordItem[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    return this.findByDateRange(startAt, endAt, agentId);
  };

  /**
   * @description Group usage records by day for a given date range.
   */
  private groupByDay = (
    spends: UsageRecordItem[],
    startAt: string,
    endAt: string,
    pad = true,
  ): UsageLog[] => {
    // Clustering by time
    const usages = new Map<string, { date: Date; logs: UsageRecordItem[] }>();
    spends.forEach((spend) => {
      if (!usages.has(formatDate(spend.createdAt))) {
        usages.set(formatDate(spend.createdAt), { date: spend.createdAt, logs: [spend] });
        return;
      }
      usages.get(formatDate(spend.createdAt))?.logs.push(spend);
    });
    // Calculate usage
    const usageLogs: UsageLog[] = [];
    usages.forEach((spends, date) => {
      const totalSpend = spends.logs.reduce((acc, spend) => acc + spend.spend, 0);
      const totalTokens = spends.logs.reduce((acc, spend) => (spend.totalTokens || 0) + acc, 0);
      const totalRequests = spends.logs?.length ?? 0;
      log(
        'date',
        date,
        'totalSpend',
        totalSpend,
        'totalTokens',
        totalTokens,
        'totalRequests',
        totalRequests,
      );
      usageLogs.push({
        date: spends.date.getTime(),
        day: date,
        records: spends.logs,
        totalRequests,
        totalSpend,
        totalTokens,
      });
    });

    if (!pad) return usageLogs;

    // Padding to ensure the date range is complete
    const startDate = dayjs(startAt);
    const endDate = dayjs(endAt);
    const paddedUsageLogs: UsageLog[] = [];
    log(
      'Padding usage logs from',
      startDate.format('YYYY-MM-DD'),
      'to',
      endDate.format('YYYY-MM-DD'),
    );
    for (let date = startDate; date.isBefore(endDate); date = date.add(1, 'day')) {
      const found = usageLogs.find((l) => l.day === date.format('YYYY-MM-DD'));
      if (found) {
        paddedUsageLogs.push(found);
      } else {
        paddedUsageLogs.push({
          date: date.toDate().getTime(),
          day: date.format('YYYY-MM-DD'),
          records: [],
          totalRequests: 0,
          totalSpend: 0,
          totalTokens: 0,
        });
      }
    }
    return paddedUsageLogs;
  };

  findAndGroupByDay = async (mo?: string, agentId?: string): Promise<UsageLog[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    const spends = await this.findByDateRange(startAt, endAt, agentId);
    return this.groupByDay(spends, startAt, endAt);
  };

  /**
   * @description Find usage grouped by day for a custom date range (e.g. past 12 months).
   * Does not pad missing days for large ranges.
   * @param agentId When provided, only count messages produced by this agent.
   */
  findAndGroupByDateRange = async (
    startAt: string,
    endAt: string,
    agentId?: string,
  ): Promise<UsageLog[]> => {
    const spends = await this.findByDateRange(startAt, endAt, agentId);
    return this.groupByDay(spends, startAt, endAt, false);
  };

  /**
   * @description Rich per-agent usage stats: cost (with cache savings), token
   * totals, and per-bucket input/output/cache-write split for a trend chart,
   * plus a per-model breakdown. Bucketed by day or week across [startAt, endAt].
   */
  getAgentUsageStats = async (
    agentId: string,
    startAt: string,
    endAt: string,
    granularity: AgentUsageGranularity = 'day',
  ): Promise<AgentUsageStats> => {
    const rows = await this.db
      .select({
        createdAt: messages.createdAt,
        metadata: messages.metadata,
        model: messages.model,
        provider: messages.provider,
        usage: messages.usage,
      })
      .from(messages)
      .where(
        genWhere([
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            { userId: messages.userId, workspaceId: messages.workspaceId },
          ),
          eq(messages.role, 'assistant'),
          notCopiedTranscript(),
          eq(messages.agentId, agentId),
          genRangeWhere([startAt, endAt], messages.createdAt, (date) => date.toDate()),
        ]),
      )
      .orderBy(asc(messages.createdAt));

    const bucketStart = (date: Date) =>
      granularity === 'week' ? dayjs(date).startOf('week') : dayjs(date).startOf('day');

    const buckets = new Map<string, AgentUsageBucket>();
    const models = new Map<string, AgentUsageModelRow>();
    const summary = {
      cacheHitRate: 0,
      cacheReadTokens: 0,
      cacheSavings: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      totalTokens: 0,
    };
    let cacheMissTokens = 0;

    for (const row of rows) {
      const metadata = row.metadata as MessageMetadata | null;
      const usage = (row.usage as ModelUsage | null) ?? metadata?.usage;
      const storedCost = usage?.cost ?? metadata?.cost ?? 0;
      const split = computeMessageCostSplit(usage, row.provider, row.model, storedCost);

      // bucket
      const start = bucketStart(row.createdAt);
      const key = start.format('YYYY-MM-DD');
      const bucket = buckets.get(key) ?? {
        cachedInputCost: 0,
        cachedInputTokens: 0,
        cacheWriteCost: 0,
        cacheWriteTokens: 0,
        date: start.valueOf(),
        inputCost: 0,
        inputTokens: 0,
        label: start.format('M/D'),
        outputCost: 0,
        outputTokens: 0,
        totalCost: 0,
      };
      bucket.inputCost += split.inputCost;
      bucket.cachedInputCost += split.cachedInputCost;
      bucket.outputCost += split.outputCost;
      bucket.cacheWriteCost += split.cacheWriteCost;
      bucket.totalCost += split.totalCost;
      bucket.inputTokens += split.cacheMissTokens;
      bucket.cachedInputTokens += split.cacheReadTokens;
      bucket.outputTokens += split.outputTokens;
      bucket.cacheWriteTokens += split.cacheWriteTokens;
      buckets.set(key, bucket);

      // per-model
      const model = row.model || 'unknown';
      const provider = row.provider || 'unknown';
      const modelKey = `${provider}/${model}`;
      const modelRow = models.get(modelKey) ?? {
        cost: 0,
        id: modelKey,
        model,
        provider,
        requests: 0,
        totalTokens: 0,
      };
      modelRow.cost += split.totalCost;
      modelRow.totalTokens += split.totalTokens;
      modelRow.requests += 1;
      models.set(modelKey, modelRow);

      // summary
      summary.totalCost += split.totalCost;
      summary.cacheSavings += split.cacheSavings;
      summary.cacheReadTokens += split.cacheReadTokens;
      summary.inputTokens += split.inputTokens;
      summary.outputTokens += split.outputTokens;
      summary.totalTokens += split.totalTokens;
      summary.totalRequests += 1;
      cacheMissTokens += split.cacheMissTokens;
    }

    const cacheBase = summary.cacheReadTokens + cacheMissTokens;
    summary.cacheHitRate = cacheBase > 0 ? summary.cacheReadTokens / cacheBase : 0;

    // pad missing buckets so the chart spans the whole range
    const step = granularity === 'week' ? 'week' : 'day';
    const padded: AgentUsageBucket[] = [];
    const end = dayjs(endAt);
    for (
      let cursor = bucketStart(dayjs(startAt).toDate());
      cursor.isBefore(end) || cursor.isSame(end, step);
      cursor = cursor.add(1, step)
    ) {
      const key = cursor.format('YYYY-MM-DD');
      padded.push(
        buckets.get(key) ?? {
          cachedInputCost: 0,
          cachedInputTokens: 0,
          cacheWriteCost: 0,
          cacheWriteTokens: 0,
          date: cursor.valueOf(),
          inputCost: 0,
          inputTokens: 0,
          label: cursor.format('M/D'),
          outputCost: 0,
          outputTokens: 0,
          totalCost: 0,
        },
      );
    }

    return {
      buckets: padded,
      byModel: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      summary,
    };
  };
}
