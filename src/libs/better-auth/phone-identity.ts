import type { LobeChatDatabase } from '@/database/type';

const MAINLAND_MOBILE = /^1[3-9]\d{9}$/;

export class PhoneIdentityConflictError extends Error {
  constructor(
    readonly normalizedPhone: string,
    readonly ownerUserId: string,
  ) {
    super('The verified phone number belongs to another account');
    this.name = 'PhoneIdentityConflictError';
  }
}

/** Normalize a mainland China mobile number to its canonical E.164 identity key. */
export const normalizeMainlandPhoneE164 = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;

  const compact = value.trim().replaceAll(/[\s()-]/g, '');
  const national = compact.startsWith('+86')
    ? compact.slice(3)
    : compact.startsWith('0086')
      ? compact.slice(4)
      : compact.startsWith('86') && compact.length === 13
        ? compact.slice(2)
        : compact;

  if (!MAINLAND_MOBILE.test(national)) return;
  return `+86${national}`;
};

/**
 * Resolve a verified phone as an identity match without ever merging users.
 * Callers must send a conflict to the explicit recovery/merge flow.
 */
export const assertVerifiedPhoneOwner = (params: {
  currentUserId: string;
  normalizedPhone: string;
  ownerUserId?: null | string;
}): void => {
  if (params.ownerUserId && params.ownerUserId !== params.currentUserId) {
    throw new PhoneIdentityConflictError(params.normalizedPhone, params.ownerUserId);
  }
};

export const hasVerifiedPhoneIdentity = (user: {
  phone?: null | string;
  phoneNumberVerified?: boolean | null;
}): boolean => Boolean(user.phoneNumberVerified && normalizeMainlandPhoneE164(user.phone));

export const findVerifiedPhoneIdentity = async (db: LobeChatDatabase, userId: string) =>
  db.query.users.findFirst({
    columns: { phone: true, phoneNumberVerified: true },
    where: (user, { eq }) => eq(user.id, userId),
  });

export const isPhoneBindingExempt = (userId: string, configuredIds = ''): boolean =>
  configuredIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
