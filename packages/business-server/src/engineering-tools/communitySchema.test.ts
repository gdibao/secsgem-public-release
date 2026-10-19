import { describe, expect, it } from 'vitest';

import { ratingWriteSchema, saveMyDraftSchema } from './communitySchema';
import { panelStateWriteSchema } from './workspaceSchema';

const draft = {
  category: 'Process', description: 'Synthetic test tool', license: 'Unknown', name: 'Candidate',
  section: 'process', shape: 'web', summary: 'Synthetic', visibility: 'public',
};

describe('community input boundaries', () => {
  it('accepts HTTPS metadata while refusing local or credential-bearing links', () => {
    expect(saveMyDraftSchema.safeParse({ ...draft, officialWebsiteUrl: 'https://vendor.example.com/tool' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'https://app.localhost.:8443/', 'https://127.0.0.1/tool',
      'https://user:pass@example.com/', 'http://example.com/']) {
      expect(saveMyDraftSchema.safeParse({ ...draft, runUrl: url }).success).toBe(false);
    }
  });

  it('bounds panel tab state and rejects duplicate or orphan active IDs', () => {
    const tabId = '2879619d-dd64-4f9b-a922-94e742f579c9';
    const valid = { activeTabId: tabId, expectedVersion: 0, panelOpen: true,
      tabs: [{ closed: false, endpointId: null, id: tabId, kind: 'detail', toolId: 'PG001' }], width: 2048 };
    expect(panelStateWriteSchema.safeParse(valid).success).toBe(true);
    expect(panelStateWriteSchema.safeParse({ ...valid, tabs: [valid.tabs[0], valid.tabs[0]] }).success).toBe(false);
    expect(panelStateWriteSchema.safeParse({ ...valid, activeTabId: '51ca9f15-7ceb-43f1-9375-2437682f28ac' }).success).toBe(false);
    expect(panelStateWriteSchema.safeParse({ ...valid, tabs: [{ ...valid.tabs[0], closed: true }] }).success).toBe(false);
    expect(panelStateWriteSchema.safeParse({ ...valid, width: 4097 }).success).toBe(false);
    expect(panelStateWriteSchema.safeParse({ ...valid, tabs: Array.from({ length: 31 }, (_, i) => ({
      closed: false, endpointId: null, id: `2879619d-dd64-4f9b-a922-${String(i).padStart(12, '0')}`,
      kind: 'detail', toolId: `PG${String(i).padStart(3, '0')}`,
    })) }).success).toBe(false);
  });

  it('accepts only integer one-to-five ratings with explicit CAS version', () => {
    expect(ratingWriteSchema.safeParse({ expectedVersion: 0, score: 5, toolId: 'PG001' }).success).toBe(true);
    expect(ratingWriteSchema.safeParse({ expectedVersion: 0, score: 0, toolId: 'PG001' }).success).toBe(false);
    expect(ratingWriteSchema.safeParse({ expectedVersion: 0, score: 3.5, toolId: 'PG001' }).success).toBe(false);
  });
});
