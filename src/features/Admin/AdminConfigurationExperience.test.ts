import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepoFile = (filePath: string) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');

const configurationPages = [
  'src/features/Admin/AdminGrowthPage.tsx',
  'src/features/Admin/AdminModelPolicyPage.tsx',
  'src/features/Admin/AdminFileStoragePage.tsx',
  'src/features/Admin/AdminPptSettingsPage.tsx',
];

describe('admin configuration management experience', () => {
  it('uses the shared responsive hierarchy and stable form actions on every page', () => {
    for (const filePath of configurationPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toContain('AdminPageShell');
      expect(page, filePath).toContain('AdminSection');
      expect(page, filePath).toContain('AdminFormGrid');
      expect(page, filePath).toContain('AdminPageError');
      expect(page, filePath).toContain('AdminFormActions');
      expect(page, filePath).not.toContain('<Divider');
      expect(page, filePath).not.toContain('padding={24}');
      expect(page, filePath).not.toContain('style={{ maxWidth');
    }
  });

  it('blocks writes until current settings load and uses Base UI actions', () => {
    for (const filePath of configurationPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toMatch(
        /import \{[^}]*\bButton\b[^}]*\} from '@lobehub\/ui\/base-ui'/,
      );
      expect(page, filePath).not.toMatch(/import \{[^}]*\bButton\b[^}]*\} from 'antd'/);
      expect(page, filePath).toContain('if (!data) return;');
      expect(page, filePath).toContain('disabled={isLoading || !data');
    }
  });

  it('uses the Base UI select for PPT creator settings', () => {
    const page = readRepoFile('src/features/Admin/AdminPptSettingsPage.tsx');

    expect(page).toMatch(/import \{[^}]*\bSelect\b[^}]*\} from '@lobehub\/ui\/base-ui'/);
    expect(page).not.toMatch(/import \{[^}]*\bSelect\b[^}]*\} from 'antd'/);
  });
});
