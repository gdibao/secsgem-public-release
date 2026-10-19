import type { DesktopReleaseChannel } from '@lobechat/types';

import {
  normalizeDesktopDownloadUrl,
  normalizeDesktopUpdateServerUrl,
} from '@/const/desktopUpdate';
import { appSettings } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { APP_SETTING_KEYS } from '@/server/services/appSettings';

export interface DesktopReleasePublicationInput {
  channel: DesktopReleaseChannel;
  downloadLabel?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  serverUrl?: string;
  version: string;
}

export interface NormalizedDesktopReleasePublication extends Omit<
  DesktopReleasePublicationInput,
  'downloadUrl' | 'serverUrl'
> {
  downloadUrl?: string;
  serverUrl?: string;
}

export const normalizeDesktopReleasePublication = (
  input: DesktopReleasePublicationInput,
): NormalizedDesktopReleasePublication => {
  const normalizedServerUrl = normalizeDesktopUpdateServerUrl(input.serverUrl);
  if ('reason' in normalizedServerUrl) {
    throw new Error(`serverUrl is not allowed: ${normalizedServerUrl.reason}`);
  }
  const normalizedDownloadUrl = normalizeDesktopDownloadUrl(input.downloadUrl);
  if ('reason' in normalizedDownloadUrl) {
    throw new Error(`downloadUrl is not allowed: ${normalizedDownloadUrl.reason}`);
  }

  return {
    ...input,
    downloadUrl: normalizedDownloadUrl.url || undefined,
    serverUrl: normalizedServerUrl.url || undefined,
  };
};

const upsertSetting = async (db: LobeChatDatabase | Transaction, key: string, value: unknown) =>
  db
    .insert(appSettings)
    .values({ key, value: value as any })
    .onConflictDoUpdate({
      set: { updatedAt: new Date(), value: value as any },
      target: appSettings.key,
    });

export const writeDesktopReleasePublicationSettings = async (
  db: LobeChatDatabase | Transaction,
  input: NormalizedDesktopReleasePublication,
): Promise<number> => {
  const updates: Array<{ key: string; value: unknown }> = [
    { key: APP_SETTING_KEYS.desktopUpdateChannel, value: input.channel },
    { key: APP_SETTING_KEYS.desktopUpdateCurrentVersion, value: input.version },
  ];
  if (input.serverUrl) {
    updates.push({ key: APP_SETTING_KEYS.desktopUpdateServerUrl, value: input.serverUrl });
  }
  if (input.releaseNotes !== undefined) {
    updates.push({
      key: APP_SETTING_KEYS.desktopUpdateReleaseNotes,
      value: input.releaseNotes.trim(),
    });
  }
  if (input.downloadUrl) {
    updates.push({ key: APP_SETTING_KEYS.desktopDownloadUrl, value: input.downloadUrl });
  }
  if (input.downloadLabel !== undefined) {
    updates.push({
      key: APP_SETTING_KEYS.desktopDownloadLabel,
      value: input.downloadLabel.trim(),
    });
  }

  for (const update of updates) await upsertSetting(db, update.key, update.value);
  return updates.length;
};
