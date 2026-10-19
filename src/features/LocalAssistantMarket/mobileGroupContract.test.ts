import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileActions = readFileSync(
  resolve('src/routes/(mobile)/(home)/features/SessionListContent/CollapseGroup/Actions.tsx'),
  'utf8',
);

describe('mobile native group entry contract', () => {
  it('exposes the native menu and create entry, then creates a private group', () => {
    expect(mobileActions).toContain('data-testid="native-mobile-group-menu"');
    expect(mobileActions).toContain('data-testid="native-mobile-create-group"');
    expect(mobileActions).toContain("visibility: 'private'");
    expect(mobileActions).toContain('<MemberSelectionModal');
  });
});
