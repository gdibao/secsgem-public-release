import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readRepoFile = (filePath: string) =>
  readFileSync(path.resolve(__dirname, '../../../..', filePath), 'utf8');

describe('admin desktop control center experience', () => {
  it('uses the shared admin shell for a responsive control center surface', () => {
    const page = readRepoFile('src/features/Admin/DesktopControlCenter/index.tsx');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('width="full"');
    expect(page).toContain('admin.desktopControl.subtitle');
    expect(page).not.toContain('desktopControlCenterStyles.page');
    expect(page).not.toContain('padding={24}');
  });

  it('keeps all desktop management surfaces and unsaved navigation protection', () => {
    const page = readRepoFile('src/features/Admin/DesktopControlCenter/index.tsx');

    for (const tab of ['overview', 'distribution', 'updates', 'brand', 'build-profile']) {
      expect(page).toContain(`key: '${tab}'`);
    }
    expect(page).toContain('useBlocker');
    expect(page).toContain('confirmDiscard');
    expect(page).toContain('onReleaseActivated');
  });
});
