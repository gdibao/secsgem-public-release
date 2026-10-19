import { inArray } from 'drizzle-orm';

import { type AppSettingKey } from '@/const/appSettingsRegistry';
import { appSettings } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { APP_SETTINGS_CATALOG, APP_SETTINGS_SECTION_KEYS } from './catalog';
import { type AppSettingsSection } from './types';

type AppSettingRow = { key: string; value: unknown };

export const ALL_APP_SETTING_KEYS = APP_SETTINGS_CATALOG.map((item) => item.key);

export class AppSettingsSnapshot {
  private readonly storedKeys: ReadonlySet<AppSettingKey>;
  private readonly values: ReadonlyMap<AppSettingKey, unknown>;

  readonly requestedKeys: readonly AppSettingKey[];

  constructor(requestedKeys: readonly AppSettingKey[], rows: readonly AppSettingRow[]) {
    const uniqueKeys = Array.from(new Set(requestedKeys));
    const values = new Map<AppSettingKey, unknown>(uniqueKeys.map((key) => [key, null]));
    const storedKeys = new Set<AppSettingKey>();

    for (const row of rows) {
      const key = row.key as AppSettingKey;
      if (!values.has(key)) continue;

      values.set(key, row.value ?? null);
      storedKeys.add(key);
    }

    this.requestedKeys = Object.freeze(uniqueKeys);
    this.storedKeys = storedKeys;
    this.values = values;
  }

  entries = () => Array.from(this.values.entries());

  get = (key: AppSettingKey): unknown => this.values.get(key) ?? null;

  has = (key: AppSettingKey): boolean => this.storedKeys.has(key);

  toRecord = (): Record<string, unknown> => Object.fromEntries(this.values);
}

export const loadAppSettingsSnapshot = async (
  db: LobeChatDatabase,
  requestedKeys: readonly AppSettingKey[],
): Promise<AppSettingsSnapshot> => {
  const keys = Array.from(new Set(requestedKeys));
  if (keys.length === 0) return new AppSettingsSnapshot([], []);

  const rows = await db.query.appSettings.findMany({
    columns: { key: true, value: true },
    where: inArray(appSettings.key, keys),
  });

  return new AppSettingsSnapshot(keys, rows);
};

export const loadAllAppSettingsSnapshot = (db: LobeChatDatabase) =>
  loadAppSettingsSnapshot(db, ALL_APP_SETTING_KEYS);

export const loadAppSettingsSectionSnapshot = (db: LobeChatDatabase, section: AppSettingsSection) =>
  loadAppSettingsSnapshot(db, APP_SETTINGS_SECTION_KEYS[section]);
