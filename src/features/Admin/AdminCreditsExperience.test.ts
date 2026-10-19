import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/credits/index.tsx');

describe('AdminCreditsPage experience contract', () => {
  it('uses shared admin states and protects operations while data is unavailable', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('disabled={isLoading || Boolean(error)}');
    expect(page).toContain('onRetry={refresh}');
    expect(page).toContain("flexWrap: 'wrap'");
  });
});
