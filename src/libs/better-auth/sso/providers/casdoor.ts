import { authEnv } from '@/envs/auth';
import { getCasdoorIdentityEmail } from '@/libs/better-auth/identity-email.server';
import { normalizeMainlandPhoneE164 } from '@/libs/better-auth/phone-identity';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_CASDOOR_ID: string;
  AUTH_CASDOOR_ISSUER: string;
  AUTH_CASDOOR_SECRET: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_CASDOOR_ID,
      clientSecret: env.AUTH_CASDOOR_SECRET,
      issuer: env.AUTH_CASDOOR_ISSUER,
      scopes: ['openid', 'email', 'profile', 'phone'],
      overrides: {
        overrideUserInfo: true,
        mapProfileToUser: (profile) => {
          const subject = String(profile.id || profile.sub || '').trim();
          if (!subject) throw new Error('[Better-Auth] Casdoor profile is missing its subject');
          if (!authEnv.AUTH_SECRET) {
            throw new Error('[Better-Auth] AUTH_SECRET is required for Casdoor identities');
          }

          const verifiedEmail =
            typeof profile.email === 'string' && profile.email.trim().length > 0
              ? profile.email.trim().toLowerCase()
              : undefined;
          const composedName = [profile.firstName, profile.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          const fallbackName = composedName.length > 0 ? composedName : undefined;
          const normalizedPhone = normalizeMainlandPhoneE164(profile.phone);

          return {
            email: verifiedEmail || getCasdoorIdentityEmail(subject, authEnv.AUTH_SECRET),
            emailVerified: Boolean(verifiedEmail && profile.emailVerified),
            image: profile.avatar ?? profile.permanentAvatar,
            name: profile.displayName ?? fallbackName ?? profile.name ?? verifiedEmail ?? subject,
            ...(normalizedPhone
              ? { phone: normalizedPhone, phoneNumberVerified: true }
              : { phoneNumberVerified: false }),
          };
        },
      },
      providerId: 'casdoor',
    }),
  checkEnvs: () => {
    return !!(authEnv.AUTH_CASDOOR_ID && authEnv.AUTH_CASDOOR_SECRET && authEnv.AUTH_CASDOOR_ISSUER)
      ? {
          AUTH_CASDOOR_ID: authEnv.AUTH_CASDOOR_ID,
          AUTH_CASDOOR_ISSUER: authEnv.AUTH_CASDOOR_ISSUER,
          AUTH_CASDOOR_SECRET: authEnv.AUTH_CASDOOR_SECRET,
        }
      : false;
  },
  id: 'casdoor',
  type: 'generic',
};

export default provider;
