import { describe, expect, it } from 'vitest';

import { selectAdminHubTab } from './AdminManagementHubs';

describe('admin management hubs', () => {
  it('keeps recognized tabs and falls back for invalid URL state', () => {
    const tabs = ['topics', 'files', 'documents'] as const;

    expect(selectAdminHubTab(tabs, 'topics', 'files')).toBe('files');
    expect(selectAdminHubTab(tabs, 'topics', 'unknown')).toBe('topics');
    expect(selectAdminHubTab(tabs, 'topics', null)).toBe('topics');
  });
});
