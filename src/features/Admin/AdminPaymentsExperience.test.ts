import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const page = readFileSync(
  path.resolve(__dirname, '../../..', 'src/features/Admin/AdminPaymentsPage.tsx'),
  'utf8',
);

describe('admin payment center experience', () => {
  it('uses the shared page shell, recoverable settings error, and stable save actions', () => {
    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminFormActions');
    expect(page).toContain('onRetry={settings.mutate}');
    expect(page).toContain('Skeleton active');
    expect(page).not.toContain('padding={24}');
    expect(page).not.toContain('<Title');
  });

  it('retains payment permissions, settings ownership, secret handling, and tab routing', () => {
    expect(page).toContain('ADMIN_CAPABILITIES.systemRead');
    expect(page).toContain('ADMIN_CAPABILITIES.financeRead');
    expect(page).toContain('SECRET_FIELDS');
    expect(page).toContain('FIELD_KEYS');
    expect(page).toContain("ADMIN_SETTINGS_SECTION_SWR_KEY('payments')");
    expect(page).toContain('useUnsavedChangesGuard');
    expect(page).toContain('PAYMENT_CENTER_TABS');
    expect(page).toContain('legacyEnvironmentKeys');
    expect(page).toContain('admin.payments.legacyEnvironment.title');
  });
});
