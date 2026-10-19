import { describe, expect, it } from 'vitest';

import {
  buildReferralLink,
  getReferralAvailableCredits,
  normalizeReferralCodeInput,
} from './referralDisplay';

describe('referral display helpers', () => {
  it('extracts a seven digit referral code from plain text', () => {
    expect(normalizeReferralCodeInput(' 78790097 ')).toBe('7879009');
    expect(normalizeReferralCodeInput('ref: 123-456-789')).toBe('1234567');
  });

  it('extracts referral codes from shared signup links', () => {
    expect(normalizeReferralCodeInput('https://chat.example.com/signup?ref=7654321')).toBe(
      '7654321',
    );
    expect(
      normalizeReferralCodeInput('https://chat.example.com/signup?referral=1112223&utm=test'),
    ).toBe('1112223');
  });

  it('returns an empty string when a link has no referral parameter', () => {
    expect(normalizeReferralCodeInput('https://chat.example.com/signup?utm=test')).toBe('');
  });

  it('uses only the referral ledger balance for the available balance', () => {
    expect(getReferralAvailableCredits({ referral: { available: 2_500_000 } })).toBe(2_500_000);
    expect(getReferralAvailableCredits({ referral: { available: -1 } })).toBe(0);
    expect(getReferralAvailableCredits()).toBe(0);
  });

  it('does not create a referral query parameter until the server code is loaded', () => {
    expect(buildReferralLink('https://chat.example.com', '')).toBe(
      'https://chat.example.com/signup',
    );
    expect(buildReferralLink('https://chat.example.com', '1234567')).toBe(
      'https://chat.example.com/signup?ref=1234567',
    );
  });
});
