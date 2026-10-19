import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useVerifyEmail } from './useVerifyEmail';

interface VerifyEmailContentProps {
  callbackUrl: string;
  email: string | null;
  token: string | null;
}

export const VerifyEmailContent = ({ email, callbackUrl, token }: VerifyEmailContentProps) => {
  const { t } = useTranslation('auth');
  const { handleResendEmail, resending, verificationState } = useVerifyEmail({
    callbackUrl,
    email,
    token,
  });

  const statusText =
    verificationState === 'verifying'
      ? t('betterAuth.verifyEmail.verify.inProgress', {
          defaultValue: '正在验证邮箱…',
        })
      : verificationState === 'success'
        ? t('betterAuth.verifyEmail.verify.success', {
            defaultValue: '邮箱验证成功，正在进入驰拓 AI 助手…',
          })
        : t('betterAuth.verifyEmail.checkSpam');

  return (
    <Flexbox gap={16}>
      <Block padding={24}>
        <Text align={'center'}>{statusText}</Text>
      </Block>
      {verificationState !== 'success' && (
        <Button
          icon={<RefreshCw size={16} />}
          loading={resending || verificationState === 'verifying'}
          size="large"
          type="default"
          onClick={handleResendEmail}
        >
          {t('betterAuth.verifyEmail.resend.button')}
        </Button>
      )}
    </Flexbox>
  );
};
