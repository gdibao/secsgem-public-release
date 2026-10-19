import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');

describe('admin credit unit contract', () => {
  it('converts plan and top-up form values at the API boundary', () => {
    const plans = readSource('src/routes/(main)/admin/plans/index.tsx');
    const packages = readSource('src/features/Admin/AdminTopUpPackagesPage.tsx');

    for (const source of [plans, packages]) {
      expect(source).toContain('toAdminAtomicCredits');
      expect(source).toContain('toAdminDisplayCredits');
      expect(source).toContain("addonAfter={'M'}");
    }
  });

  it('converts every general-commercial admin adjustment before submission', () => {
    const sources = [
      readSource('src/routes/(main)/admin/credits/index.tsx'),
      readSource('src/routes/(main)/admin/users/index.tsx'),
      readSource('src/features/Admin/AdminUserDetailDrawer.tsx'),
      readSource('src/routes/(main)/admin/redemption/index.tsx'),
    ];

    for (const source of sources) expect(source).toContain('toAdminAtomicCredits');
  });

  it('formats plan, order, subscription, and user detail values as M Credits', () => {
    const sources = [
      readSource('src/routes/(main)/admin/plans/index.tsx'),
      readSource('src/features/Admin/AdminTopUpPackagesPage.tsx'),
      readSource('src/features/Admin/AdminOrdersPage.tsx'),
      readSource('src/features/Admin/AdminSubscriptionsPage.tsx'),
      readSource('src/features/Admin/AdminUserDetailDrawer.tsx'),
    ];

    for (const source of sources) expect(source).toContain('formatAdminCredits');
  });
});
