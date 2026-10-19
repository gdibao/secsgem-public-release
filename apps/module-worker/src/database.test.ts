import { describe, expect, it, vi } from 'vitest';

import {
  createModuleAppWorkerPoolConfig,
  createModuleAppWorkerReadModel,
} from './database';

describe('createModuleAppWorkerReadModel', () => {
  it('returns bounded eligible queue depth and oldest age', async () => {
    const query = vi.fn(async () => ({
      rows: [{ depth: '7', oldest_eligible_age_ms: '1234.8' }],
    }));
    const readModel = createModuleAppWorkerReadModel(query);

    await expect(readModel.getQueueStats()).resolves.toEqual({
      depth: 7,
      oldestEligibleAgeMs: 1234.8,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'queued'"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'building'"));
  });

  it('checks only the exact unexpired active claim', async () => {
    const query = vi.fn(async (_sql: string, values?: unknown[]) => ({
      rows: values?.[1] === 'active-token' ? [{ active: 1 }] : [],
    }));
    const readModel = createModuleAppWorkerReadModel(query);

    await expect(
      readModel.isClaimActive({ buildId: 'build-id', claimToken: 'active-token' }),
    ).resolves.toBe(true);
    await expect(
      readModel.isClaimActive({ buildId: 'build-id', claimToken: 'inactive-token' }),
    ).resolves.toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('claim_expires_at > NOW()'), [
      'build-id',
      'active-token',
    ]);
  });
});

describe('createModuleAppWorkerPoolConfig', () => {
  it('bounds claim database waits inside the 40 second shutdown window', () => {
    const config = createModuleAppWorkerPoolConfig({
      databaseUrl: 'postgresql://worker:secret@postgres/module-worker',
      shutdownTimeoutMs: 40_000,
    });

    expect(config).toMatchObject({
      connectionTimeoutMillis: 5000,
      idle_in_transaction_session_timeout: 5000,
      lock_timeout: 2500,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
    expect(
      Number(config.connectionTimeoutMillis) + Number(config.statement_timeout) * 5,
    ).toBeLessThan(40_000);
  });
});
