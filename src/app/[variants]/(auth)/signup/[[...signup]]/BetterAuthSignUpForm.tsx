'use client';

import { Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Divider, Form, Input, type InputRef } from 'antd';
import { Lock, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthIcons from '../../../../../components/AuthIcons';
import { shouldAutoStartCasdoor } from '../../../../../features/Auth/autoCasdoor';
import { AuthCard } from '../../../../../features/AuthCard';
import { trackLoginOrSignupClicked } from '../../../../../features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { AuthAgreement, useAuthAgreement } from '../../_layout/AuthAgreement';
import { useSignUp } from './useSignUp';

const BetterAuthSignUpForm = () => {
  const { form, loading, onSubmit, onWechatSignUp, preferEmail, businessElement } = useSignUp();

  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement();

  const emailInputRef = useRef<InputRef>(null);
  const passwordInputRef = useRef<InputRef>(null);
  const autoWechatStarted = useRef(false);

  useEffect(() => {
    const shouldStart = shouldAutoStartCasdoor({
      inProgress: loading,
      preferEmail,
      providerAvailable: true,
      ready: true,
      started: autoWechatStarted.current,
    });
    if (!shouldStart) return;
    autoWechatStarted.current = true;
    void onWechatSignUp();
  }, [loading, onWechatSignUp, preferEmail]);

  useEffect(() => {
    const email = searchParams.get('email');
    if (email) {
      form.setFieldsValue({ email });
      passwordInputRef.current?.focus();
    } else {
      emailInputRef.current?.focus();
    }
  }, [searchParams, form]);

  const footer = (
    <Text>
      {t('betterAuth.signup.hasAccount')}{' '}
      <Link
        href={`/signin?${searchParams.toString()}`}
        onClick={(event) => {
          event.preventDefault();
          void trackLoginOrSignupClicked({ spm: 'signup.go_to_signin.click' }).finally(() => {
            router.push(`/signin?${searchParams.toString()}`);
          });
        }}
      >
        {t('betterAuth.signup.signinLink')}
      </Link>
    </Text>
  );

  return (
    <AuthCard
      footer={footer}
      subtitle={t('betterAuth.signup.subtitle')}
      title={t('betterAuth.signup.title')}
    >
      <Button
        block
        icon={<Icon icon={AuthIcons('casdoor', 18)} />}
        loading={loading}
        size="large"
        type="primary"
        onClick={() =>
          continueWithAgreement(() => {
            void onWechatSignUp();
          })
        }
      >
        {loading && !preferEmail ? '正在加载微信二维码…' : '微信扫码登录 / 注册'}
      </Button>
      <Divider plain>或使用邮箱注册</Divider>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) =>
          continueWithAgreement(() => {
            void onSubmit(values);
          })
        }
      >
        <Form.Item
          name="email"
          rules={[
            { message: t('betterAuth.errors.emailRequired'), required: true },
            { message: t('betterAuth.errors.emailInvalid'), type: 'email' },
          ]}
        >
          <Input
            autoComplete="email"
            inputMode="email"
            placeholder={t('betterAuth.signup.emailPlaceholder')}
            ref={emailInputRef}
            size="large"
            type="email"
            prefix={
              <Icon
                icon={Mail}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[
            { message: t('betterAuth.errors.passwordRequired'), required: true },
            { message: t('betterAuth.errors.passwordMinLength'), min: 8 },
            { max: 64, message: t('betterAuth.errors.passwordMaxLength') },
            {
              message: t('betterAuth.errors.passwordFormat'),
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                const hasLetter = /[a-z]/i.test(value);
                const hasNumber = /\d/.test(value);
                return hasLetter && hasNumber ? Promise.resolve() : Promise.reject();
              },
            },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={t('betterAuth.signup.passwordPlaceholder')}
            ref={passwordInputRef}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>
        <Form.Item
          dependencies={['password']}
          name="confirmPassword"
          rules={[
            { message: t('betterAuth.errors.confirmPasswordRequired'), required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t('betterAuth.errors.passwordMismatch')));
              },
            }),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={t('betterAuth.signup.confirmPasswordPlaceholder')}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>

        {businessElement}

        <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
        <Form.Item>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.signup.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
