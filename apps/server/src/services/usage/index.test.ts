import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LobeChatDatabase } from '@/database/type';
import { type MessageMetadata } from '@/types/message';

import { UsageRecordService } from './index';

/**
 * Recursively walk an object graph (cycle-safe) looking for `target` as a
 * substring of any string value. Used to assert that a bound value (e.g. an
 * agent id) made it into the composed drizzle WHERE clause.
 */
const deepIncludes = (value: unknown, target: string, seen = new Set<unknown>()): boolean => {
  if (typeof value === 'string') return value.includes(target);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).some((v) => deepIncludes(v, target, seen));
};

describe('UsageRecordService', () => {
  let service: UsageRecordService;
  let mockDb: LobeChatDatabase;
  const userId = 'test-user-id';

  // Helper function to setup query chain mock
  const setupQueryChainMock = (mockMessages: any[]) => {
    const mockOrderBy = vi.fn().mockResolvedValue(mockMessages);
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockLedgerWhere = vi.fn().mockResolvedValue([]);
    const mockLedgerFrom = vi.fn().mockReturnValue({ where: mockLedgerWhere });
    mockDb.select = vi.fn().mockReturnValueOnce({ from: mockFrom }).mockReturnValue({
      from: mockLedgerFrom,
    });
  };

  // Variant that also captures the args passed to `.where(...)` so tests can
  // assert what ended up in the composed WHERE clause.
  const setupCapturingMock = (mockMessages: any[]) => {
    const whereArgs: unknown[] = [];
    const mockOrderBy = vi.fn().mockResolvedValue(mockMessages);
    const mockWhere = vi.fn().mockImplementation((arg: unknown) => {
      whereArgs.push(arg);
      return { orderBy: mockOrderBy };
    });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockLedgerWhere = vi.fn().mockResolvedValue([]);
    const mockLedgerFrom = vi.fn().mockReturnValue({ where: mockLedgerWhere });
    mockDb.select = vi.fn().mockReturnValueOnce({ from: mockFrom }).mockReturnValue({
      from: mockLedgerFrom,
    });
    return { whereArgs };
  };

  beforeEach(() => {
    // Create a fresh mock for each test
    const mockOrderBy = vi.fn();
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockDb = {
      select: mockSelect,
    } as unknown as LobeChatDatabase;

    service = new UsageRecordService(mockDb, userId);
  });

  describe('findByMonth', () => {
    it('should return usage records for the current month when no month is provided', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: new Date(),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
            tps: 10,
            ttft: 500,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'msg-1',
        model: 'gpt-4',
        provider: 'openai',
        spend: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        tps: 10,
        ttft: 500,
        type: 'chat',
        userId,
      });
    });

    it('should return usage records for a specific month', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-3',
          createdAt: new Date('2024-01-15'),
          metadata: {
            cost: 0.03,
            totalInputTokens: 80,
            totalOutputTokens: 40,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth('2024-01');

      expect(result[0].model).toBe('claude-3');
      expect(result[0].spend).toBe(0.03);
    });

    it('prefers the top-level usage column over metadata.usage', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: new Date(),
          // dedicated column must win over the legacy metadata.usage
          usage: { cost: 0.05, totalInputTokens: 100, totalOutputTokens: 50 },
          metadata: {
            usage: { cost: 9.9, totalInputTokens: 999, totalOutputTokens: 999 },
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth();

      expect(result[0]).toMatchObject({
        spend: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      });
    });

    it('should handle messages with missing metadata fields', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          createdAt: new Date(),
          metadata: {} as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        spend: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        tps: 0,
        ttft: 0,
      });
    });

    it('should return empty array when no messages found', async () => {
      setupQueryChainMock([]);

      const result = await service.findByMonth();

      expect(result).toHaveLength(0);
    });

    it('should use commercial ledger cost when assistant message metadata has no cost', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'newapi',
          model: 'gpt-4o',
          createdAt: new Date('2024-01-15'),
          metadata: {
            totalInputTokens: 1000,
            totalOutputTokens: 500,
          } as MessageMetadata,
        },
      ];
      const mockLedgerRows = [
        {
          metadata: { chargedCredits: 120_000, usdCost: 0.12 },
          referenceId: 'msg-1',
        },
      ];
      const messagesOrderBy = vi.fn().mockResolvedValue(mockMessages);
      const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
      const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });
      const ledgerWhere = vi.fn().mockResolvedValue(mockLedgerRows);
      const ledgerFrom = vi.fn().mockReturnValue({ where: ledgerWhere });
      const generationLedgerWhere = vi.fn().mockResolvedValue([]);
      const generationLedgerFrom = vi.fn().mockReturnValue({ where: generationLedgerWhere });

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce({ from: messagesFrom })
        .mockReturnValueOnce({ from: ledgerFrom })
        .mockReturnValueOnce({ from: generationLedgerFrom });

      const result = await service.findByMonth('2024-01');

      expect(result[0].spend).toBe(0.12);
    });

    it('reports charged credits from the ledger independently of provider cost', async () => {
      const mockMessages = [
        {
          createdAt: new Date('2024-01-15'),
          id: 'msg-1',
          metadata: {} as MessageMetadata,
          model: 'gpt-4o',
          provider: 'newapi',
          role: 'assistant',
          usage: { cost: 0.02, totalInputTokens: 1000, totalOutputTokens: 500 },
          userId,
        },
      ];
      const mockLedgerRows = [
        {
          amount: -350_000,
          metadata: { chargedCredits: 350_000, usdCost: 0.02 },
          referenceId: 'msg-1',
        },
      ];
      const messagesOrderBy = vi.fn().mockResolvedValue(mockMessages);
      const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
      const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });
      const ledgerWhere = vi.fn().mockResolvedValue(mockLedgerRows);
      const ledgerFrom = vi.fn().mockReturnValue({ where: ledgerWhere });
      const generationLedgerWhere = vi.fn().mockResolvedValue([]);
      const generationLedgerFrom = vi.fn().mockReturnValue({ where: generationLedgerWhere });

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce({ from: messagesFrom })
        .mockReturnValueOnce({ from: ledgerFrom })
        .mockReturnValueOnce({ from: generationLedgerFrom });

      const result = await service.findByMonth('2024-01');

      expect(result[0]).toMatchObject({ credits: 350_000, id: 'msg-1', spend: 0.02 });
    });

    it('should include billable ledger usage records', async () => {
      const messagesOrderBy = vi.fn().mockResolvedValue([]);
      const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
      const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });
      const generationLedgerRows = [
        {
          amount: -250_000,
          createdAt: new Date('2024-01-15T10:00:00Z'),
          description: 'image usage: gpt-image-2',
          id: 'ledger-image',
          metadata: {
            modelUsage: {
              totalInputTokens: 11,
              totalOutputTokens: 0,
              totalTokens: 11,
            },
            routeMetadata: {
              providerType: 'openai',
            },
          },
          referenceId: 'image-task',
          referenceType: 'image_generation',
          title: 'Image Generation',
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          userId,
        },
        {
          amount: -1_000_000,
          createdAt: new Date('2024-01-16T10:00:00Z'),
          description: 'video usage: veo-3',
          id: 'ledger-video',
          metadata: {
            routeMetadata: {
              providerType: 'google',
            },
            usage: {
              completionTokens: 88,
              totalTokens: 120,
            },
          },
          referenceId: 'video-task',
          referenceType: 'video_generation',
          title: 'Video Generation',
          updatedAt: new Date('2024-01-16T10:00:00Z'),
          userId,
        },
        {
          amount: -500_000,
          createdAt: new Date('2024-01-17T10:00:00Z'),
          description: 'Docmee PPT generation',
          id: 'ledger-ppt',
          metadata: {
            upstreamTaskId: 'ppt-upstream',
          },
          referenceId: 'ppt-session',
          referenceType: 'ppt_generation',
          title: 'PPT Generation',
          updatedAt: new Date('2024-01-17T10:00:00Z'),
          userId,
        },
        {
          amount: -1,
          createdAt: new Date('2024-01-18T10:00:00Z'),
          description: 'AI Embeddings Usage',
          id: 'ledger-embedding',
          metadata: {
            model: 'text-embedding-3-small',
            provider: 'newapi',
            totalInputTokens: 12,
            totalOutputTokens: 0,
            totalTokens: 12,
          },
          referenceId: 'embeddings:1',
          referenceType: 'model_runtime_embeddings',
          title: 'AI Embeddings Usage',
          updatedAt: new Date('2024-01-18T10:00:00Z'),
          userId,
        },
        {
          amount: -10_000,
          createdAt: new Date('2024-01-19T10:00:00Z'),
          description: 'AI Structured Output Usage',
          id: 'ledger-structured',
          metadata: {
            model: 'gpt-4o-mini',
            provider: 'newapi',
            totalInputTokens: 20,
            totalOutputTokens: 10,
            totalTokens: 30,
          },
          referenceId: 'generate_object:1',
          referenceType: 'model_runtime_generate_object',
          title: 'AI Structured Output Usage',
          updatedAt: new Date('2024-01-19T10:00:00Z'),
          userId,
        },
      ];
      const generationLedgerWhere = vi.fn().mockResolvedValue(generationLedgerRows);
      const generationLedgerFrom = vi.fn().mockReturnValue({ where: generationLedgerWhere });

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce({ from: messagesFrom })
        .mockReturnValueOnce({ from: generationLedgerFrom });

      const result = await service.findByMonth('2024-01');

      expect(result.map((record) => record.type)).toEqual([
        'structured_output',
        'embedding',
        'ppt',
        'video',
        'image',
      ]);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            credits: 250_000,
            id: 'ledger-image',
            model: 'gpt-image-2',
            provider: 'openai',
            spend: 0.25,
            totalInputTokens: 11,
            totalOutputTokens: 0,
            totalTokens: 11,
            type: 'image',
          }),
          expect.objectContaining({
            id: 'ledger-video',
            model: 'veo-3',
            provider: 'google',
            spend: 1,
            totalInputTokens: 32,
            totalOutputTokens: 88,
            totalTokens: 120,
            type: 'video',
          }),
          expect.objectContaining({
            id: 'ledger-ppt',
            model: 'ppt',
            provider: 'docmee',
            spend: 0.5,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            type: 'ppt',
          }),
          expect.objectContaining({
            id: 'ledger-embedding',
            model: 'text-embedding-3-small',
            provider: 'newapi',
            spend: 0.000_001,
            totalInputTokens: 12,
            totalOutputTokens: 0,
            totalTokens: 12,
            type: 'embedding',
          }),
          expect.objectContaining({
            id: 'ledger-structured',
            model: 'gpt-4o-mini',
            provider: 'newapi',
            spend: 0.01,
            totalInputTokens: 20,
            totalOutputTokens: 10,
            totalTokens: 30,
            type: 'structured_output',
          }),
        ]),
      );
    });
    it('forwards agentId to findByDateRange', async () => {
      const spy = vi.spyOn(service, 'findByDateRange').mockResolvedValue([]);

      await service.findByMonth('2024-01', 'agent-42');

      expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'agent-42');
    });
  });

  describe('findAndGroupByDay', () => {
    it('should group usage records by day for current month', async () => {
      const date1 = dayjs().startOf('month').toDate();
      const date2 = dayjs().startOf('month').add(1, 'day').toDate();

      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: date1,
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
        {
          id: 'msg-2',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: date1,
          metadata: {
            cost: 0.03,
            totalInputTokens: 60,
            totalOutputTokens: 30,
          } as MessageMetadata,
        },
        {
          id: 'msg-3',
          userId,
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-3',
          createdAt: date2,
          metadata: {
            cost: 0.02,
            totalInputTokens: 40,
            totalOutputTokens: 20,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      expect(result.length).toBeGreaterThan(0);

      // Check that days with records have correct aggregations
      const dayWithRecords = result.find((log) => log.totalRequests > 0);
      if (dayWithRecords) {
        expect(dayWithRecords.totalSpend).toBeGreaterThan(0);
        expect(dayWithRecords.totalTokens).toBeGreaterThan(0);
        expect(dayWithRecords.records.length).toBeGreaterThan(0);
      }
    });

    it('should pad missing days with zero values', async () => {
      const firstDay = dayjs().startOf('month');

      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: firstDay.toDate(),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      // Should have entries for every day in the month
      const daysInMonth = dayjs().endOf('month').date();
      expect(result.length).toBeGreaterThanOrEqual(daysInMonth - 1);

      // Check that padded days have zero values
      const paddedDay = result.find((log) => log.totalRequests === 0);
      if (paddedDay) {
        expect(paddedDay.totalSpend).toBe(0);
        expect(paddedDay.totalTokens).toBe(0);
        expect(paddedDay.records).toHaveLength(0);
      }
    });

    it('should calculate correct totals for days with multiple records', async () => {
      const testDate = dayjs().startOf('month').toDate();

      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: testDate,
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
        {
          id: 'msg-2',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: testDate,
          metadata: {
            cost: 0.03,
            totalInputTokens: 60,
            totalOutputTokens: 30,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      const dayLog = result.find((log) => log.totalRequests === 2);

      if (dayLog) {
        expect(dayLog.totalSpend).toBe(0.08);
        expect(dayLog.totalTokens).toBe(240); // (100+50) + (60+30)
        expect(dayLog.totalRequests).toBe(2);
        expect(dayLog.records).toHaveLength(2);
      }
    });

    it('forwards agentId to findByDateRange', async () => {
      const spy = vi.spyOn(service, 'findByDateRange').mockResolvedValue([]);

      await service.findAndGroupByDay('2024-01', 'agent-99');

      expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'agent-99');
    });

    it('scopes the query to a single agent when agentId is provided', async () => {
      const { whereArgs } = setupCapturingMock([
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: dayjs().startOf('month').toDate(),
          agentId: 'agt_123',
          metadata: { cost: 0.05, totalInputTokens: 100, totalOutputTokens: 50 } as MessageMetadata,
        },
      ]);

      const result = await service.findAndGroupByDay(undefined, 'agt_123');

      // the composed WHERE clause must carry the agent id as a bound value
      expect(deepIncludes(whereArgs[0], 'agt_123')).toBe(true);
      // and the records still map through correctly
      expect(result.some((log) => log.totalRequests > 0)).toBe(true);
    });

    it('does not add an agent filter when agentId is omitted', async () => {
      const { whereArgs } = setupCapturingMock([]);

      await service.findAndGroupByDay();

      // no bound value should reference an agent id (none was passed)
      expect(deepIncludes(whereArgs[0], 'agt_')).toBe(false);
    });

    it('should handle specific month parameter', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: new Date('2024-01-15'),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay('2024-01');

      expect(result.length).toBeGreaterThan(0);
      // All days should be from January 2024
      result.forEach((log) => {
        expect(log.day).toMatch(/^2024-01/);
      });
    });

    it('should include generation ledger usage in daily totals', async () => {
      const messagesOrderBy = vi.fn().mockResolvedValue([]);
      const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
      const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });
      const generationLedgerRows = [
        {
          amount: -250_000,
          createdAt: new Date('2024-01-15T10:00:00Z'),
          description: 'image usage: gpt-image-2',
          id: 'ledger-image',
          metadata: {
            modelUsage: {
              totalInputTokens: 11,
              totalOutputTokens: 0,
              totalTokens: 11,
            },
          },
          referenceId: 'image-task',
          referenceType: 'image_generation',
          title: 'Image Generation',
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          userId,
        },
      ];
      const generationLedgerWhere = vi.fn().mockResolvedValue(generationLedgerRows);
      const generationLedgerFrom = vi.fn().mockReturnValue({ where: generationLedgerWhere });

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce({ from: messagesFrom })
        .mockReturnValueOnce({ from: generationLedgerFrom });

      const result = await service.findAndGroupByDay('2024-01');
      const dayLog = result.find((log) => log.day === '2024-01-15');

      expect(dayLog).toMatchObject({
        totalRequests: 1,
        totalSpend: 0.25,
        totalTokens: 11,
      });
      expect(dayLog?.records[0]).toMatchObject({
        id: 'ledger-image',
        type: 'image',
      });
    });
  });

  describe('copied transcripts', () => {
    // Duplicated history (agent copy / workspace import) consumed its tokens in
    // the SOURCE scope. Counting it again here would inflate the target's
    // spend, request counts and per-model rows, so every report filters it out.
    it('excludes copied rows from the usage record query', async () => {
      const { whereArgs } = setupCapturingMock([]);

      await service.findByDateRange('2024-01-01', '2024-01-31');

      expect(deepIncludes(whereArgs[0], `'copied'`)).toBe(true);
      // COALESCE form only. Null-testing a jsonb arrow expression in a WHERE
      // clause crashes the production engine before it reads a row, and no
      // test against real Postgres can catch it — so the shape is asserted
      // here, both ways round.
      expect(deepIncludes(whereArgs[0], `coalesce`)).toBe(true);
      expect(deepIncludes(whereArgs[0], `is distinct from`)).toBe(false);
    });

    it('excludes copied rows from the agent usage stats query', async () => {
      const { whereArgs } = setupCapturingMock([]);

      await service.getAgentUsageStats('agt_123', '2024-01-01', '2024-01-31', 'day');

      expect(deepIncludes(whereArgs[0], `'copied'`)).toBe(true);
      // COALESCE form only. Null-testing a jsonb arrow expression in a WHERE
      // clause crashes the production engine before it reads a row, and no
      // test against real Postgres can catch it — so the shape is asserted
      // here, both ways round.
      expect(deepIncludes(whereArgs[0], `coalesce`)).toBe(true);
      expect(deepIncludes(whereArgs[0], `is distinct from`)).toBe(false);
    });
  });
});
