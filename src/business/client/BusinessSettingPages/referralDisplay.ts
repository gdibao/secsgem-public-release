const normalizeReferralDigits = (value: string) => value.replaceAll(/\D/g, '').slice(0, 7);

export const getReferralAvailableCredits = (breakdown?: { referral?: { available?: number } }) => {
  const available = breakdown?.referral?.available;
  return typeof available === 'number' && Number.isFinite(available) && available >= 0
    ? available
    : 0;
};

export const buildReferralLink = (siteOrigin: string, referralCode?: string | null) => {
  const code = typeof referralCode === 'string' ? referralCode.trim() : '';
  return code ? `${siteOrigin}/signup?ref=${encodeURIComponent(code)}` : `${siteOrigin}/signup`;
};

export const normalizeReferralCodeInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const referralCode = url.searchParams.get('ref') || url.searchParams.get('referral') || '';

      return normalizeReferralDigits(referralCode);
    } catch {
      return '';
    }
  }

  return normalizeReferralDigits(trimmed);
};
