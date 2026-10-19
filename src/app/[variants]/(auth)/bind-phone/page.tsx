'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Image, Input } from 'antd';
import { Phone, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import AuthCard from '@/features/AuthCard';
import { listAccounts, oauth2, signIn, useSession } from '@/libs/better-auth/auth-client';
import { hasVerifiedPhoneIdentity } from '@/libs/better-auth/phone-identity';
import { sanitizeRedirectPath, toAbsoluteAuthCallbackUrl } from '@/utils/onboardingRedirect';

const errorMessage: Record<string, string> = {
  CASDOOR_REAUTH_REQUIRED: '当前登录凭据已过期，请重新完成微信或邮箱认证后继续。',
  CASDOOR_VERIFICATION_FAILED: '验证码错误、已过期或发送受限，请核对后重试。',
  CASDOOR_UPSTREAM_FAILED: '认证服务暂时不可用，请稍后重试。',
  CAPTCHA_INVALID: '图形验证码错误或已失效，已为你刷新，请重新输入。',
  CAPTCHA_REQUIRED: '请先输入图形验证码。',
  CAPTCHA_UNAVAILABLE: '图形验证码暂时不可用，请刷新后重试。',
  INVALID_CODE: '请输入短信中的有效验证码。',
  INVALID_ORIGIN: '请求来源校验失败，请刷新当前页面后重试。',
  INVALID_PHONE: '请输入有效的中国大陆手机号。',
  PHONE_BINDING_FAILED: '手机验证暂时失败，请稍后重试。',
  PHONE_BINDING_NOT_CONFIGURED: '手机验证服务尚未配置完成，请联系管理员。',
  PHONE_IDENTITY_CONFLICT: '该手机号已属于另一个账号，请使用账号恢复流程，系统不会自动合并或覆盖。',
  SMS_CODE_INVALID: '短信验证码错误、已过期或已使用，请重新获取。',
  SMS_RATE_LIMITED: '短信发送过于频繁，请稍后再试。',
  SMS_SEND_FAILED: '短信发送失败，请稍后重试；如持续失败请联系管理员。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
};

const postBinding = async (path: string, body: Record<string, string>) => {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(result?.code || 'PHONE_BINDING_FAILED');
};

const BindPhonePage = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const captchaRequest = useRef(0);
  const captchaUser = useRef<string | undefined>(undefined);
  const callbackUrl = sanitizeRedirectPath(searchParams.get('callbackUrl') || '/');

  const showError = useCallback((cause: unknown) => {
    const code = cause instanceof Error ? cause.message : 'PHONE_BINDING_FAILED';
    setNeedsReauth(code === 'CASDOOR_REAUTH_REQUIRED' || code === 'UNAUTHORIZED');
    setError(errorMessage[code] || errorMessage.PHONE_BINDING_FAILED);
  }, []);

  const refreshCaptcha = useCallback(async () => {
    const requestId = ++captchaRequest.current;
    setCaptchaLoading(true);
    try {
      const response = await fetch('/api/auth/phone-binding/captcha', {
        credentials: 'same-origin',
        method: 'POST',
      });
      const result = (await response.json()) as {
        captchaId?: string;
        captchaImage?: string;
        code?: string;
      };
      if (!response.ok || !result.captchaId || !result.captchaImage) {
        throw new Error(result.code || 'CAPTCHA_UNAVAILABLE');
      }
      if (requestId === captchaRequest.current) {
        setCaptchaId(result.captchaId);
        setCaptchaImage(result.captchaImage);
        setCaptchaToken('');
      }
    } catch (cause) {
      if (requestId === captchaRequest.current) showError(cause);
    } finally {
      if (requestId === captchaRequest.current) setCaptchaLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (session.data?.user && hasVerifiedPhoneIdentity(session.data.user)) {
      window.location.replace(callbackUrl);
    } else if (session.data?.user && captchaUser.current !== session.data.user.id) {
      captchaUser.current = session.data.user.id;
      void fetch('/api/auth/phone-binding/status', { credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) return;
          const result = (await response.json()) as { canSkip?: boolean };
          setCanSkip(result.canSkip === true);
        })
        .catch(() => setCanSkip(false));
      void refreshCaptcha();
    }
  }, [callbackUrl, refreshCaptcha, session.data?.user?.id, session.data?.user]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const reauthenticate = async () => {
    if (!session.data?.user) {
      router.push(
        `/signin?callbackUrl=${encodeURIComponent(`/bind-phone?callbackUrl=${encodeURIComponent(callbackUrl)}`)}`,
      );
      return;
    }

    setConfirming(true);
    setError(undefined);
    const returnUrl = toAbsoluteAuthCallbackUrl(
      `/bind-phone?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      window.location.origin,
    );
    try {
      const accounts = await listAccounts();
      const casdoorLinked = accounts.data?.some((account) => account.providerId === 'casdoor');
      const result = casdoorLinked
        ? await signIn.oauth2({ callbackURL: returnUrl, providerId: 'casdoor' })
        : await oauth2.link({ callbackURL: returnUrl, providerId: 'casdoor' });
      if (result.error) throw result.error;
    } catch {
      setError('重新认证未完成，请检查网络后重试。');
    } finally {
      setConfirming(false);
    }
  };

  const sendCode = async () => {
    setError(undefined);
    setNeedsReauth(false);
    setSending(true);
    try {
      await postBinding('/api/auth/phone-binding/send-code', {
        captchaId,
        captchaToken,
        phone,
      });
      setCountdown(60);
    } catch (cause) {
      showError(cause);
      void refreshCaptcha();
    } finally {
      setSending(false);
    }
  };

  const confirm = async () => {
    setError(undefined);
    setNeedsReauth(false);
    setConfirming(true);
    try {
      await postBinding('/api/auth/phone-binding/confirm', { code, phone });
      window.location.replace(callbackUrl);
    } catch (cause) {
      showError(cause);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AuthCard
      centered
      subtitle="验证码、有效期和短信发送均由 Casdoor 官方流程及现有阿里云短信服务处理。"
      title="完成手机验证"
    >
      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={10}>
          <ShieldCheck size={20} />
          <Text>手机号是已验证的唯一身份匹配键，Fab 内部仍使用不可变用户 ID。</Text>
        </Flexbox>
        <Input
          addonBefore="+86"
          autoComplete="tel-national"
          inputMode="numeric"
          maxLength={11}
          placeholder="请输入 11 位手机号"
          size="large"
          value={phone}
          onChange={(event) => setPhone(event.target.value.replaceAll(/\D/g, ''))}
        />
        <Flexbox horizontal align="center" gap={10}>
          <Input
            autoComplete="off"
            maxLength={8}
            placeholder="图形验证码"
            size="large"
            value={captchaToken}
              onChange={(event) => setCaptchaToken(event.target.value.replaceAll(/\s/g, ''))}
          />
          {captchaImage && (
            <Image
              key={captchaId}
              preview={false}
              src={`data:image/png;base64,${captchaImage}`}
              style={{ height: 44, width: 120 }}
            />
          )}
          <Button
            disabled={captchaLoading || sending}
            icon={<RefreshCw size={16} />}
            loading={captchaLoading}
            size="large"
            title="刷新验证码"
            onClick={() => void refreshCaptcha()}
          />
        </Flexbox>
        <Flexbox horizontal gap={10}>
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={8}
            placeholder="短信验证码"
            size="large"
            value={code}
            onChange={(event) => setCode(event.target.value.replaceAll(/\D/g, ''))}
          />
          <Button
            disabled={countdown > 0 || phone.length !== 11 || !captchaId || !captchaToken}
            loading={sending}
            size="large"
            style={{ minWidth: 128 }}
            onClick={sendCode}
          >
            {countdown > 0 ? `${countdown} 秒后重发` : '发送验证码'}
          </Button>
        </Flexbox>
        <Flexbox horizontal align="center" gap={10}>
          <Phone size={20} />
          <Text>号码冲突不会静默合并；验证码过期或失败时可在本页重试。</Text>
        </Flexbox>
        {error && <Text color="var(--ant-color-error)">{error}</Text>}
        {needsReauth ? (
          <Button block loading={confirming} size="large" type="primary" onClick={reauthenticate}>
            重新认证后继续
          </Button>
        ) : (
          <Flexbox gap={10}>
            <Button
              block
              disabled={phone.length !== 11 || code.length < 4}
              loading={confirming}
              size="large"
              type="primary"
              onClick={confirm}
            >
              验证并继续
            </Button>
            {canSkip && (
              <Button block size="large" onClick={() => window.location.replace(callbackUrl)}>
                以后配置
              </Button>
            )}
          </Flexbox>
        )}
      </Flexbox>
    </AuthCard>
  );
};

export default BindPhonePage;
