import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createModuleAppNotificationRateLimitBackend,
  createModuleAppReplayGuardBackend,
} from './distributedGuards';

const { getRedisClient } = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: getRedisClient,
}));

describe('module app distributed guards', () => {
  beforeEach(() => {
    getRedisClient.mockReset();
  });

  it('uses Redis SET NX with a hashed replay key and capability TTL', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    getRedisClient.mockReturnValue({ set });
    const backend = createModuleAppReplayGuardBackend();

    await expect(backend.consume('installation:nonce:request', 300)).resolves.toBe(true);
    await expect(backend.consume('installation:nonce:request', 300)).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith(
      expect.stringMatching(/^module-app:replay:[a-f0-9]{64}$/),
      '1',
      'EX',
      300,
      'NX',
    );
    expect(set.mock.calls[0][0]).not.toContain('installation');
  });

  it('uses one atomic Redis sliding-window operation for notification limits', async () => {
    const evalCommand = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    getRedisClient.mockReturnValue({ eval: evalCommand });
    const backend = createModuleAppNotificationRateLimitBackend({ randomId: () => 'event-1' });

    await expect(backend.consume('installation-1', 10, 60_000)).resolves.toBe(true);
    await expect(backend.consume('installation-1', 10, 60_000)).resolves.toBe(false);
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZREMRANGEBYSCORE'"),
      1,
      expect.stringMatching(/^module-app:notification-rate:[a-f0-9]{64}$/),
      expect.any(Number),
      60_000,
      10,
      'event-1',
    );
  });

  it('retains process-local protection only in explicitly allowed environments', async () => {
    getRedisClient.mockReturnValue(null);
    const replay = createModuleAppReplayGuardBackend({ mode: 'memory-allowed' });
    const rateLimit = createModuleAppNotificationRateLimitBackend({
      mode: 'memory-allowed',
      randomId: () => 'event',
    });

    await expect(replay.consume('same-request', 300)).resolves.toBe(true);
    await expect(replay.consume('same-request', 300)).resolves.toBe(false);
    for (let index = 0; index < 10; index++) {
      await expect(rateLimit.consume('installation-1', 10, 60_000)).resolves.toBe(true);
    }
    await expect(rateLimit.consume('installation-1', 10, 60_000)).resolves.toBe(false);
  });

  it('fails closed when Redis is unavailable in distributed-required mode', async () => {
    getRedisClient.mockReturnValue(null);
    const replay = createModuleAppReplayGuardBackend({ mode: 'distributed-required' });
    const rateLimit = createModuleAppNotificationRateLimitBackend({
      mode: 'distributed-required',
    });

    await expect(replay.consume('same-request', 300)).rejects.toThrow(
      'MODULE_APP_DISTRIBUTED_GUARD_UNAVAILABLE',
    );
    await expect(rateLimit.consume('installation-1', 10, 60_000)).rejects.toThrow(
      'MODULE_APP_DISTRIBUTED_GUARD_UNAVAILABLE',
    );
  });

  it('propagates Redis command failures instead of using process-local state', async () => {
    const redisError = new Error('redis unavailable');
    getRedisClient.mockReturnValue({ set: vi.fn().mockRejectedValue(redisError) });
    const replay = createModuleAppReplayGuardBackend({ mode: 'distributed-required' });

    await expect(replay.consume('same-request', 300)).rejects.toBe(redisError);
  });
});
