import { createHmac } from 'node:crypto';

import { CASDOOR_IDENTITY_EMAIL_DOMAIN } from './identity-email';

export const getCasdoorIdentityEmail = (subject: string, secret: string): string => {
  const digest = createHmac('sha256', secret).update(subject).digest('hex').slice(0, 32);

  return `casdoor-${digest}@${CASDOOR_IDENTITY_EMAIL_DOMAIN}`;
};
