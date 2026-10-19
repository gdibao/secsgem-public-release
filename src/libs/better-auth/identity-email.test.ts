import { describe, expect, it } from 'vitest';

import { CASDOOR_IDENTITY_EMAIL_DOMAIN, isIdentityPlaceholderEmail } from './identity-email';
import { getCasdoorIdentityEmail } from './identity-email.server';

describe('Casdoor identity email', () => {
  it('creates a stable non-deliverable address without exposing the subject', () => {
    const email = getCasdoorIdentityEmail('casdoor-user-123', 'test-secret');

    expect(email).toMatch(new RegExp(`^casdoor-[a-f0-9]{32}@${CASDOOR_IDENTITY_EMAIL_DOMAIN}$`));
    expect(email).not.toContain('casdoor-user-123');
    expect(getCasdoorIdentityEmail('casdoor-user-123', 'test-secret')).toBe(email);
  });

  it('changes when the provider subject or application secret changes', () => {
    expect(getCasdoorIdentityEmail('user-a', 'secret-a')).not.toBe(
      getCasdoorIdentityEmail('user-b', 'secret-a'),
    );
    expect(getCasdoorIdentityEmail('user-a', 'secret-a')).not.toBe(
      getCasdoorIdentityEmail('user-a', 'secret-b'),
    );
  });

  it('recognizes only the reserved internal identity domain', () => {
    expect(isIdentityPlaceholderEmail(getCasdoorIdentityEmail('user', 'secret'))).toBe(true);
    expect(isIdentityPlaceholderEmail('user@example.com')).toBe(false);
    expect(isIdentityPlaceholderEmail(undefined)).toBe(false);
  });
});
