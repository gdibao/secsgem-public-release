import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const APP_SETTINGS_CACHE_VERSION_KEY = 'comhub:app-settings:cache-version';

export const getAppSettingsCacheVersion = async (): Promise<null | string> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  try {
    return await redis.get(APP_SETTINGS_CACHE_VERSION_KEY);
  } catch {
    return null;
  }
};

export const bumpAppSettingsCacheVersion = async (): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;

  try {
    await redis.incr(APP_SETTINGS_CACHE_VERSION_KEY);
  } catch {
    // Local invalidation still applies when the shared cache is unavailable.
  }
};
