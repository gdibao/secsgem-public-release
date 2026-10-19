'use client';

import { useEffect, useRef } from 'react';

import { shouldAutoStartCasdoor } from '../autoCasdoor';
import DevSeedSignIn from './DevSeedSignIn';
import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';

const SignIn = () => {
  const {
    disableEmailPassword,
    email,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleResendEmail,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    preferEmail,
    sending,
    sessionExpired,
    sentInfo,
    serverConfigInit,
    socialLoading,
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

  if (step === 'emailSent' && sentInfo)
    return (
      <SignInEmailSentStep
        email={sentInfo.email}
        sending={sending}
        type={sentInfo.type}
        onBack={handleBackFromSent}
        onResend={handleResendEmail}
      />
    );

  if (step === 'password')
    return (
      <SignInPasswordStep
        email={email}
        forgotLoading={sending}
        form={form as any}
        loading={loading}
        onBackToEmail={handleBackToEmail}
        onForgotPassword={handleForgotPassword}
        onSubmit={handleSignIn}
      />
    );

  return (
    <>
      <SignInEmailStep
        disableEmailPassword={disableEmailPassword}
        form={form as any}
        isSocialOnly={isSocialOnly}
        lastAuthProvider={lastAuthProvider}
        loading={loading}
        oAuthSSOProviders={oAuthSSOProviders}
        serverConfigInit={serverConfigInit}
        sessionExpired={sessionExpired}
        socialLoading={socialLoading}
        onCheckUser={handleCheckUser}
        onGoToSignup={handleGoToSignup}
        onResetEmail={handleBackToEmail}
        onSetPassword={handleForgotPassword}
        onSocialSignIn={handleSocialSignIn}
      />
      <DevSeedSignIn />
    </>
  );
};

export default SignIn;
