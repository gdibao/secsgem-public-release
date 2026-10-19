import { describe, expect, it } from 'vitest';

import {
  assertVerifiedPhoneOwner,
  normalizeMainlandPhoneE164,
  PhoneIdentityConflictError,
} from './phone-identity';

describe('verified phone identity', () => {
  it.each([
    ['13800138000', '+8613800138000'],
    ['+86 138 0013 8000', '+8613800138000'],
    ['0086-138-0013-8000', '+8613800138000'],
    ['8613800138000', '+8613800138000'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMainlandPhoneE164(input)).toBe(expected);
  });

  it.each(['', '23800138000', '1380013800', '+1 202 555 0100', 'not-a-phone'])(
    'rejects an unsupported or invalid number: %s',
    (input) => expect(normalizeMainlandPhoneE164(input)).toBeUndefined(),
  );

  it('accepts an unclaimed number or the same immutable userId', () => {
    expect(() =>
      assertVerifiedPhoneOwner({
        currentUserId: 'user-a',
        normalizedPhone: '+8613800138000',
      }),
    ).not.toThrow();
    expect(() =>
      assertVerifiedPhoneOwner({
        currentUserId: 'user-a',
        normalizedPhone: '+8613800138000',
        ownerUserId: 'user-a',
      }),
    ).not.toThrow();
  });

  it('rejects cross-user ownership instead of silently merging or overwriting', () => {
    expect(() =>
      assertVerifiedPhoneOwner({
        currentUserId: 'user-b',
        normalizedPhone: '+8613800138000',
        ownerUserId: 'user-a',
      }),
    ).toThrow(PhoneIdentityConflictError);
  });
});
