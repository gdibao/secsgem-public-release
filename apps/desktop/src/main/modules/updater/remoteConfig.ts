import { net } from 'electron';

import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

const logger = createLogger('updater:remoteConfig');
const REMOTE_CONFIG_TIMEOUT_MS = 5000;

export interface RemoteUpdateConfig {
  autoCheck: boolean;
  channel: string;
  checkIntervalMinutes: number;
  serverUrl: string;
}

const DEFAULT_CONFIG: RemoteUpdateConfig = {
  autoCheck: true,
  channel: 'stable',
  checkIntervalMinutes: 60,
  serverUrl: '',
};

export const fetchRemoteUpdateConfig = async (): Promise<RemoteUpdateConfig | null> => {
  const baseUrl = (getDesktopEnv().OFFICIAL_CLOUD_SERVER || '').replace(/\/+$/, '');
  if (!baseUrl) {
    logger.info('No OFFICIAL_CLOUD_SERVER configured, using local update config');
    return null;
  }

  const url = `${baseUrl}/trpc/lambda/admin.settings.getPublicDesktopUpdate`;
  logger.info(`Fetching remote update config from: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_CONFIG_TIMEOUT_MS);

  try {
    const response = await net.fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(`Remote config fetch failed with status ${response.status}`);
      return null;
    }

    const json = (await response.json()) as any;
    const data = json?.result?.data?.json ?? json?.result?.data;

    if (!data) {
      logger.warn('Remote config response has no data');
      return null;
    }

    const config: RemoteUpdateConfig = {
      autoCheck: typeof data.autoCheck === 'boolean' ? data.autoCheck : DEFAULT_CONFIG.autoCheck,
      channel:
        typeof data.channel === 'string' && data.channel ? data.channel : DEFAULT_CONFIG.channel,
      checkIntervalMinutes:
        typeof data.checkIntervalMinutes === 'number' && data.checkIntervalMinutes > 0
          ? data.checkIntervalMinutes
          : DEFAULT_CONFIG.checkIntervalMinutes,
      serverUrl: typeof data.serverUrl === 'string' ? data.serverUrl : DEFAULT_CONFIG.serverUrl,
    };

    logger.info(
      `Remote update config loaded: channel=${config.channel}, serverUrl=${config.serverUrl || '(empty)'}, interval=${config.checkIntervalMinutes}min`,
    );
    return config;
  } catch (error) {
    logger.warn(
      'Failed to fetch remote update config:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
