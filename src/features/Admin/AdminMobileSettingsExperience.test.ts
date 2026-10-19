import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const page = readFileSync(
  path.resolve(__dirname, '../../..', 'src/features/Admin/AdminMobileSettingsPage.tsx'),
  'utf8',
);

describe('admin mobile settings experience', () => {
  it('uses the shared page shell, recoverable load state, and sticky action region', () => {
    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminFormActions');
    expect(page).toContain('loadPublication');
    expect(page).toContain('onRetry={loadPublication}');
    expect(page).not.toContain('styles.page');
    expect(page).not.toContain('styles.actionRow');
  });

  it('retains draft, publish, rollback, validation, and unsaved navigation behavior', () => {
    expect(page).toContain('useMobilePublicationActions');
    expect(page).toContain('useUnsavedChangesGuard');
    expect(page).toContain('restoreDefaults');
    expect(page).toContain('publicationState.history.map');
    expect(page).toContain('validation.messages.map');
  });
});
