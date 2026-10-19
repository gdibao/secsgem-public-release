import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const page = readFileSync(
  path.resolve(repoRoot, 'src/features/Admin/AdminModelBillingMatrixPage.tsx'),
  'utf8',
);

describe('admin model billing matrix experience', () => {
  it('uses the shared full-width page hierarchy with retry and responsive table states', () => {
    expect(page).toContain('AdminPageShell');
    expect(page).toContain('AdminPageError');
    expect(page).toContain('AdminSection');
    expect(page).toContain('AdminFormActions');
    expect(page).toContain('AdminResponsiveTable');
    expect(page).toContain('hasLoadError');
    expect(page).toContain('refreshMatrixData');
    expect(page).not.toContain('padding={24}');
    expect(page).not.toContain('<Title');
    expect(page).not.toContain('<Card');
  });

  it('guards every write path until its required source data has loaded', () => {
    expect(page).toContain('if (!canWriteSystem || !settings) return;');
    expect(page).toContain('if (!canWriteSystem || !modelData || !settings) return;');
    expect(page).toContain('if (!canWriteFinance || !planData) return;');
    expect(page).toContain('disabled={!canWriteFinance || !planData || saving}');
    expect(page).toContain('disabled={!canWriteSystem || !settings || saving}');
  });

  it('retains matrix health, validation, access, and pricing behavior', () => {
    expect(page).toContain('getMatrixConfigHealth');
    expect(page).toContain('findFreePlanDefaultModelConflict');
    expect(page).toContain('setPlanModelRulesBatch');
    expect(page).toContain('buildPricingRulesFromRows');
    expect(page).toContain('validateDefaultAgentSettings');
  });
});
