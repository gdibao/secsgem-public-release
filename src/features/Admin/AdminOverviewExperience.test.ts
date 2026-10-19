import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, './AdminOverviewPage.tsx');

describe('AdminOverviewPage experience contract', () => {
  it('keeps independent recovery for overview data sources', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageError');
    expect(page).toContain('onRetry={refreshOverview}');
    expect(page).toContain('onRetry={refreshPendingChanges}');
    expect(page).toContain('onRetry={refreshSettings}');
  });
});
