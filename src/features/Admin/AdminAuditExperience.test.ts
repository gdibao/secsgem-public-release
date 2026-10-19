import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(__dirname, '../../routes/(main)/admin/audit/index.tsx');

describe('AdminAuditPage experience contract', () => {
  it('uses shared feedback states and keeps filters responsive', () => {
    const page = fs.readFileSync(pagePath, 'utf8');

    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('onRetry={refresh}');
    expect(page).toContain("width: 'min(240px, 100%)'");
  });
});
