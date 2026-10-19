export const CASDOOR_IDENTITY_EMAIL_DOMAIN = 'identity.gdibao.invalid';

export const isIdentityPlaceholderEmail = (email?: string | null): boolean =>
  Boolean(email?.trim().toLowerCase().endsWith(`@${CASDOOR_IDENTITY_EMAIL_DOMAIN}`));
