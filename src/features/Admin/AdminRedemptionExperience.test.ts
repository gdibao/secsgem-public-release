import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/redemption/index.tsx');

describe('AdminRedemptionPage experience contract', () => {
  it('uses shared states while preserving responsive filters and bulk actions', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('onRetry={mutate}');
    expect(page).toContain("width: 'min(200px, 100%)'");
    expect(page).toContain('AdminBulkActionFlow');
  });
});
