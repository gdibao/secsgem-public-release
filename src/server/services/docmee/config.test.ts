import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCMEE_PPT_SETTINGS,
  normalizeDocmeePlanCapability,
  normalizeDocmeePptSettings,
} from './config';

describe('Docmee PPT config', () => {
  it('normalizes global settings without exposing unusable values', () => {
    const settings = normalizeDocmeePptSettings({
      'docmee.ppt.allowPdfExport': true,
      'docmee.ppt.allowPptxDownload': false,
      'docmee.ppt.apiKey': '  sk-live  ',
      'docmee.ppt.baseUrl': 'https://docmee.cn',
      'docmee.ppt.creatorVersion': 'v2',
      'docmee.ppt.defaultLang': 'zh',
      'docmee.ppt.enabled': true,
      'docmee.ppt.tokenTtlMinutes': 90,
    });

    expect(settings).toMatchObject({
      allowPdfExport: true,
      allowPptxDownload: false,
      apiKey: 'sk-live',
      baseUrl: 'https://docmee.cn',
      creatorVersion: 'v2',
      enabled: true,
      lang: 'zh',
      tokenTtlMinutes: 90,
    });
  });

  it('falls back to conservative defaults', () => {
    expect(normalizeDocmeePptSettings({})).toEqual(DEFAULT_DOCMEE_PPT_SETTINGS);
  });

  it('normalizes plan capability from plan metadata', () => {
    expect(
      normalizeDocmeePlanCapability({
        pptCreditCost: 12,
        pptEnabled: true,
        pptMonthlyQuota: 20,
      }),
    ).toEqual({ creditCost: 12, enabled: true, monthlyQuota: 20 });
  });
});
