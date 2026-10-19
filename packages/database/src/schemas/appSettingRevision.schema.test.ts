import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { appSettingRevisions } from './commercial';

describe('app setting revision schema', () => {
  it('registers monotonic section revisions in the migration journal', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../../migrations/0171_app_setting_revisions.sql'),
      'utf8',
    );
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const config = getTableConfig(appSettingRevisions);

    expect(config.name).toBe('app_setting_revisions');
    expect(config.checks.map((check) => check.name)).toContain(
      'app_setting_revisions_nonnegative_check',
    );
    expect(migration).toContain('"section" varchar(64) PRIMARY KEY');
    expect(journal.entries.some(({ tag }) => tag === '0171_app_setting_revisions')).toBe(true);
  });
});
