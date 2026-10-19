import { createHash, randomUUID } from 'node:crypto';

import type Redis from 'ioredis';

import type { ModuleAppReplayGuardBackend } from '@/business/server/module-apps/sdk/gateway';
import type { ModuleAppNotificationRateLimitBackend } from '@/business/server/module-apps/sdk/notifications';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

type GuardRedisClient = Pick<Redis, 'eval' | 'set'>;
type GuardBackendMode = 'distributed-required' | 'memory-allowed';

const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');

const NOTIFICATION_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return 1
`;

export const createModuleAppReplayGuardBackend = (
  options: {
    getRedisClient?: () => GuardRedisClient | null;
    mode?: GuardBackendMode;
  } = {},
): ModuleAppReplayGuardBackend => {
  const consumed = new Map<string, number>();
  const getRedisClient = options.getRedisClient ?? getAgentRuntimeRedisClient;

  return {
    async consume(rawKey, ttlSeconds) {
      const key = `module-app:replay:${hashKey(rawKey)}`;
      const redis = getRedisClient();
      if (redis) {
        return (await redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
      }
      if (options.mode !== 'memory-allowed') {
        throw new Error('MODULE_APP_DISTRIBUTED_GUARD_UNAVAILABLE');
      }

      const now = Date.now();
      for (const [entryKey, expiresAt] of consumed) {
        if (expiresAt <= now) consumed.delete(entryKey);
      }
      if (consumed.has(key)) return false;
      consumed.set(key, now + ttlSeconds * 1000);
      return true;
    },
  };
};

export const createModuleAppNotificationRateLimitBackend = (
  options: {
    getRedisClient?: () => GuardRedisClient | null;
    mode?: GuardBackendMode;
    now?: () => number;
    randomId?: () => string;
  } = {},
): ModuleAppNotificationRateLimitBackend => {
  const recent = new Map<string, number[]>();
  const getRedisClient = options.getRedisClient ?? getAgentRuntimeRedisClient;
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;

  return {
    async consume(installationId, limit, windowMs) {
      const timestamp = now();
      const key = `module-app:notification-rate:${hashKey(installationId)}`;
      const redis = getRedisClient();
      if (redis) {
        const result = await redis.eval(
          NOTIFICATION_RATE_LIMIT_SCRIPT,
          1,
          key,
          timestamp,
          windowMs,
          limit,
          randomId(),
        );
        return Number(result) === 1;
      }
      if (options.mode !== 'memory-allowed') {
        throw new Error('MODULE_APP_DISTRIBUTED_GUARD_UNAVAILABLE');
      }

      const entries = (recent.get(key) ?? []).filter(
        (entryTimestamp) => entryTimestamp > timestamp - windowMs,
      );
      if (entries.length >= limit) return false;
      entries.push(timestamp);
      recent.set(key, entries);
      return true;
    },
  };
};
