import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readJson = async (locale: string) =>
  JSON.parse(
    await readFile(path.join(process.cwd(), 'locales', locale, 'subscription.json'), 'utf8'),
  ) as Record<string, string>;

describe('admin mobile settings maintenance contract', () => {
  it('keeps the editor split below the project size threshold', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/features/Admin/AdminMobileSettingsPage.tsx'),
      'utf8',
    );

    expect(source.split(/\r?\n/).length).toBeLessThan(400);
    expect(source).toContain("from './MobileSettings'");
    expect(source).toContain("from './mobileSettingsHelpers'");
  });

  it('ships matching English and Simplified Chinese admin mobile keys', async () => {
    const [en, zh] = await Promise.all([readJson('en-US'), readJson('zh-CN')]);
    const enKeys = Object.keys(en)
      .filter((key) => key.startsWith('admin.mobile.'))
      .sort();
    const zhKeys = Object.keys(zh)
      .filter((key) => key.startsWith('admin.mobile.'))
      .sort();

    expect(enKeys.length).toBeGreaterThanOrEqual(45);
    expect(zhKeys).toEqual(enKeys);
    for (const key of enKeys) {
      expect(en[key], `missing en-US value: ${key}`).toBeTruthy();
      expect(zh[key], `missing zh-CN value: ${key}`).toBeTruthy();
    }
  });
});
