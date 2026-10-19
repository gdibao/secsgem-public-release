import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const mobileKeys = [
  'mobile.apps.builtIn',
  'mobile.apps.browseMarket',
  'mobile.apps.empty',
  'mobile.apps.error',
  'mobile.apps.module',
  'mobile.apps.retry',
  'mobile.apps.open',
  'mobile.apps.title',
  'mobile.design.create',
  'mobile.design.createError',
  'mobile.design.createTool',
  'mobile.design.error',
  'mobile.design.kind.document',
  'mobile.design.kind.image',
  'mobile.design.kind.ppt',
  'mobile.design.open',
  'mobile.design.recent',
  'mobile.design.retry',
  'mobile.design.startNewPresentation',
  'mobile.design.empty',
  'mobile.design.untitled',
  'mobile.discover.error',
  'mobile.discover.empty',
  'mobile.discover.open',
  'mobile.discover.retry',
  'mobile.navigation.ariaLabel',
  'mobile.recent.empty',
  'mobile.recent.emptySearch',
  'mobile.recent.createAgent',
  'mobile.recent.createAgentError',
  'mobile.recent.error',
  'mobile.recent.group',
  'mobile.recent.latest',
  'mobile.recent.loadMore',
  'mobile.recent.moreActions',
  'mobile.recent.pin',
  'mobile.recent.pinError',
  'mobile.recent.pinned',
  'mobile.recent.open',
  'mobile.recent.refresh',
  'mobile.recent.search',
  'mobile.recent.unpin',
] as const;

const readLocale = async (locale: string) =>
  JSON.parse(
    await readFile(path.join(process.cwd(), 'locales', locale, 'common.json'), 'utf8'),
  ) as Record<string, string>;

describe('mobile locale contract', () => {
  it('ships every mobile workspace key in English and Simplified Chinese', async () => {
    const [en, zh] = await Promise.all([readLocale('en-US'), readLocale('zh-CN')]);

    for (const key of mobileKeys) {
      expect(en[key], `missing en-US key: ${key}`).toBeTruthy();
      expect(zh[key], `missing zh-CN key: ${key}`).toBeTruthy();
    }
  });
});
