import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepoFile = (filePath: string) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');

const operationPages = [
  'src/features/Admin/AdminOperationsPage.tsx',
  'src/features/Admin/AdminRecommendationsPage.tsx',
  'src/features/Admin/AdminNotificationsPage.tsx',
  'src/features/Admin/AdminExpertPlazaPage.tsx',
];

describe('admin operations management experience', () => {
  it('uses the shared page hierarchy, retry state, and stable action region on every page', () => {
    for (const filePath of operationPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toContain('AdminPageShell');
      expect(page, filePath).toContain('AdminSection');
      expect(page, filePath).toContain('AdminPageError');
      expect(page, filePath).toContain('AdminFormActions');
      expect(page, filePath).not.toContain('padding={24}');
      expect(page, filePath).not.toContain('style={{ maxWidth');
    }
  });

  it('keeps saves disabled until current settings load and uses Base UI actions', () => {
    for (const filePath of operationPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toMatch(
        /import \{[^}]*\bButton\b[^}]*\} from '@lobehub\/ui\/base-ui'/,
      );
      expect(page, filePath).not.toMatch(/import \{[^}]*\bButton\b[^}]*\} from 'antd'/);
      expect(page, filePath).toContain('disabled={isLoading || !data');
    }

    for (const filePath of [
      'src/features/Admin/AdminOperationsPage.tsx',
      'src/features/Admin/AdminRecommendationsPage.tsx',
      'src/features/Admin/AdminExpertPlazaPage.tsx',
    ]) {
      expect(readRepoFile(filePath), filePath).toContain('if (!data) return;');
    }
  });

  it('uses responsive grids instead of fixed inline form rows', () => {
    for (const filePath of operationPages) {
      const page = readRepoFile(filePath);

      expect(page, filePath).toContain('AdminFormGrid');
      expect(page, filePath).not.toContain('style={{ flex: 1 }}');
      expect(page, filePath).not.toContain('style={{ marginTop: 16 }}');
    }
  });
});
