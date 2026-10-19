import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '@/server/services/appSettings';

import { loadAppSettingsSnapshot } from './loader';

const createDb = (rows: Array<{ key: string; value: unknown }> = []) => {
  const findMany = vi.fn().mockResolvedValue(rows);

  return {
    db: { query: { appSettings: { findMany } } } as any,
    findMany,
  };
};

const queryParams = (findMany: ReturnType<typeof vi.fn>) => {
  const where = findMany.mock.calls[0]?.[0]?.where;
  return new PgDialect().sqlToQuery(where).params;
};

describe('loadAppSettingsSnapshot', () => {
  it('returns an empty stable snapshot without querying for zero keys', async () => {
    const { db, findMany } = createDb();

    const snapshot = await loadAppSettingsSnapshot(db, []);

    expect(snapshot.requestedKeys).toEqual([]);
    expect(snapshot.entries()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('deduplicates requested keys before issuing one WHERE key IN query', async () => {
    const { db, findMany } = createDb([{ key: APP_SETTING_KEYS.brandName, value: 'ComHub' }]);

    const snapshot = await loadAppSettingsSnapshot(db, [
      APP_SETTING_KEYS.brandName,
      APP_SETTING_KEYS.brandName,
    ]);

    expect(snapshot.requestedKeys).toEqual([APP_SETTING_KEYS.brandName]);
    expect(queryParams(findMany)).toEqual([APP_SETTING_KEYS.brandName]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('distinguishes missing rows from stored null while reading both as null', async () => {
    const { db } = createDb([{ key: APP_SETTING_KEYS.aboutPage, value: null }]);

    const snapshot = await loadAppSettingsSnapshot(db, [
      APP_SETTING_KEYS.aboutPage,
      APP_SETTING_KEYS.aboutLinks,
    ]);

    expect(snapshot.get(APP_SETTING_KEYS.aboutPage)).toBeNull();
    expect(snapshot.has(APP_SETTING_KEYS.aboutPage)).toBe(true);
    expect(snapshot.get(APP_SETTING_KEYS.aboutLinks)).toBeNull();
    expect(snapshot.has(APP_SETTING_KEYS.aboutLinks)).toBe(false);
  });

  it('keeps entries in requested-key order regardless of database row order', async () => {
    const { db, findMany } = createDb([
      { key: APP_SETTING_KEYS.brandLogoUrl, value: 'logo.svg' },
      { key: APP_SETTING_KEYS.brandName, value: 'ComHub' },
    ]);

    const snapshot = await loadAppSettingsSnapshot(db, [
      APP_SETTING_KEYS.brandName,
      APP_SETTING_KEYS.brandLogoUrl,
      APP_SETTING_KEYS.brandSlogan,
    ]);

    expect(snapshot.entries()).toEqual([
      [APP_SETTING_KEYS.brandName, 'ComHub'],
      [APP_SETTING_KEYS.brandLogoUrl, 'logo.svg'],
      [APP_SETTING_KEYS.brandSlogan, null],
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
