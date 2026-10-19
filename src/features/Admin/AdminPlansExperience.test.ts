import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/plans/index.tsx');

describe('AdminPlansPage experience contract', () => {
  it('uses the shared shell, retry state, and responsive data region', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('disabled={isLoading || Boolean(error)}');
    expect(page).toContain('onRetry={refresh}');
    expect(page).toContain('wrap="wrap"');
  });
});
