import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepoFile = (filePath: string) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');

const managedPages = [
  'src/features/Admin/AdminDefaultSettingsPage.tsx',
  'src/features/Admin/AdminSettingsPage.tsx',
  'src/features/Admin/AdminSystemMaintenancePage.tsx',
];

describe('admin system management experience', () => {
  it('uses the shared hierarchy, recoverable loading state, and stable actions', () => {
    for (const filePath of managedPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toContain('AdminPageShell');
      expect(page, filePath).toContain('AdminPageError');
      expect(page, filePath).toContain('AdminFormActions');
      expect(page, filePath).toContain('if (!data) return;');
      expect(page, filePath).toContain('disabled={isLoading || !data');
      expect(page, filePath).not.toContain('padding={24}');
      expect(page, filePath).not.toContain('style={{ maxWidth');
    }
  });

  it('separates maintenance configuration from immediate runtime actions', () => {
    const page = readRepoFile('src/features/Admin/AdminSystemMaintenancePage.tsx');

    expect(page).toContain('AdminSection');
    expect(page).toContain('AdminFormGrid');
    expect(page).toContain('admin.maintenance.runtimeActions');
    expect(page).toContain('AdminDangerousActionButton');
    expect(page).toContain("import { Button, Modal, Select } from '@lobehub/ui/base-ui'");
  });

  it('uses the shared compact shell for merged configuration entry points', () => {
    const page = readRepoFile('src/features/Admin/AdminMergedRoutePage.tsx');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminSection');
    expect(page).toContain("import { Button } from '@lobehub/ui/base-ui'");
    expect(page).not.toContain('padding={24}');
    expect(page).not.toContain('style={{ maxWidth');
  });
});
