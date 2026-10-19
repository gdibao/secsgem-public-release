'use client';

import { Suspense, useEffect, useRef } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { shouldAutoStartCasdoor } from '@/features/Auth/autoCasdoor';

import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';

const SignInPage = () => {
  const {
    disableEmailPassword,
    email,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleGoToSignup,
    handleForgotPassword,
    handleResendEmail,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    preferEmail,
    serverConfigInit,
    socialLoading,
    sending,
    sentInfo,
    step,
  } = useSignIn();
  const autoWechatStarted = useRef(false);

  useEffect(() => {
    const shouldStart = shouldAutoStartCasdoor({
      inProgress: Boolean(socialLoading),
      preferEmail,
      providerAvailable: oAuthSSOProviders.includes('casdoor'),
      ready: serverConfigInit && step === 'email',
      started: autoWechatStarted.current,
    });
    if (!shouldStart) return;

    autoWechatStarted.current = true;
    void handleSocialSignIn('casdoor');
  }, [handleSocialSignIn, oAuthSSOProviders, preferEmail, serverConfigInit, socialLoading, step]);

  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      {step === 'emailSent' && sentInfo ? (
        <SignInEmailSentStep
          email={sentInfo.email}
          sending={sending}
          type={sentInfo.type}
          onBack={handleBackFromSent}
          onResend={handleResendEmail}
        />
      ) : step === 'email' ? (
        <SignInEmailStep
          disableEmailPassword={disableEmailPassword}
          form={form as any}
          isSocialOnly={isSocialOnly}
          lastAuthProvider={lastAuthProvider}
          loading={loading}
          oAuthSSOProviders={oAuthSSOProviders}
          serverConfigInit={serverConfigInit}
          socialLoading={socialLoading}
          onCheckUser={handleCheckUser}
          onGoToSignup={handleGoToSignup}
          onResetEmail={handleBackToEmail}
          onSetPassword={handleForgotPassword}
          onSocialSignIn={handleSocialSignIn}
        />
      ) : (
        <SignInPasswordStep
          email={email}
          forgotLoading={sending}
          form={form as any}
          loading={loading}
          onBackToEmail={handleBackToEmail}
          onForgotPassword={handleForgotPassword}
          onSubmit={handleSignIn}
        />
      )}
    </Suspense>
  );
};

export default SignInPage;
