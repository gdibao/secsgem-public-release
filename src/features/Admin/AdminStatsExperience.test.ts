import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/stats/index.tsx');

describe('AdminStatsPage experience contract', () => {
  it('uses shared metrics, error recovery, and scrollable chart regions', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminMetricStrip');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).not.toContain('@/components/antd-compat/Card');
    expect(page).not.toContain('<Card');
  });
});
