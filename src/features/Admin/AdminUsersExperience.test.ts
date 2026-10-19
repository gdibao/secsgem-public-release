import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/users/index.tsx');

describe('AdminUsersPage experience contract', () => {
  it('surfaces list recovery and protects export and modal actions', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageError');
    expect(page).toContain('onRetry={refresh}');
    expect(page).toContain('disabled={exporting}');
    expect(page).toContain('confirmLoading={actionLoading === banTarget}');
    expect(page).toContain("maxWidth: 'calc(100vw - 32px)'");
  });
});
