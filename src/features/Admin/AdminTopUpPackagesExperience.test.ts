import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const page = readFileSync(
  path.resolve(__dirname, '../../..', 'src/features/Admin/AdminTopUpPackagesPage.tsx'),
  'utf8',
);

describe('admin top-up package experience', () => {
  it('uses shared hierarchy, retry state, responsive table, and modal form grids', () => {
    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminSection');
    expect(page).toContain('AdminToolbar');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('AdminFormGrid');
    expect(page).toContain('onRetry={refresh}');
    expect(page).not.toContain('padding={embedded ? 0 : 24}');
  });

  it('retains package conversion, promotion, save, active-state, and delete behavior', () => {
    expect(page).toContain('toAdminAtomicCredits');
    expect(page).toContain('normalizeTopUpPackagePromotion');
    expect(page).toContain('adminCommercialService.upsertPackage');
    expect(page).toContain('adminCommercialService.setPackageActive');
    expect(page).toContain('adminCommercialService.deletePackage');
    expect(page).toContain('confirmModal');
  });
});
