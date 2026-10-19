import { toast } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sendVerificationEmail, verifyEmail } from '@/libs/better-auth/auth-client';
import { sanitizeRedirectPath, toAbsoluteAuthCallbackUrl } from '@/utils/onboardingRedirect';

interface UseVerifyEmailParams {
  callbackUrl: string;
  email: string | null;
  token: string | null;
}

export type VerificationState = 'idle' | 'verifying' | 'success' | 'error';

export const useVerifyEmail = ({ email, callbackUrl, token }: UseVerifyEmailParams) => {
  const { t } = useTranslation('auth');
  const [resending, setResending] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('idle');

  useEffect(() => {
    if (!token) return;

    let active = true;
    setVerificationState('verifying');

    void verifyEmail({ query: { token } })
      .then((result) => {
        if (!active) return;

        if (result.error) {
          setVerificationState('error');
          toast.error(result.error.message || t('betterAuth.verifyEmail.verify.error'));
          return;
        }

        setVerificationState('success');
        window.location.href = sanitizeRedirectPath(callbackUrl);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Error verifying email:', error);
        setVerificationState('error');
        toast.error(t('betterAuth.verifyEmail.verify.error'));
      });

    return () => {
      active = false;
    };
  }, [callbackUrl, t, token]);

  const handleResendEmail = async () => {
    if (!email) {
      toast.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    setResending(true);
    try {
      const result = await sendVerificationEmail({
        callbackURL: toAbsoluteAuthCallbackUrl(callbackUrl, window.location.origin),
        email,
      });
      if (result.error) {
        toast.error(result.error.message || t('betterAuth.verifyEmail.resend.error'));
        return;
      }
      toast.success(t('betterAuth.verifyEmail.resend.success'));
    } catch (error) {
      console.error('Error resending verification email:', error);
      toast.error(t('betterAuth.verifyEmail.resend.error'));
    } finally {
      setResending(false);
    }
  };

  return {
    handleResendEmail,
    resending,
    verificationState,
  };
};
