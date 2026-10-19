import { and, eq, ne } from 'drizzle-orm';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { UserModel } from '@/database/models/user';
import { account, users } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { normalizeMainlandPhoneE164 } from '@/libs/better-auth/phone-identity';
import { createSecondaryStorage } from '@/libs/better-auth/utils/config';

type CasdoorResponse = { data?: unknown; msg?: string; status?: string };
type CasdoorCaptchaResponse = {
  data?: { captchaId?: string; captchaImage?: string; type?: string };
  status?: string;
};

type CasdoorOperation = 'confirm-code' | 'send-code';

export class PhoneBindingError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

const requireSameOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  const expectedOrigin = new URL(appEnv.APP_URL || request.url).origin;
  if (!origin || new URL(origin).origin !== expectedOrigin) {
    throw new PhoneBindingError('INVALID_ORIGIN', 403);
  }
};

const getBindingContext = async (request: Request) => {
  requireSameOrigin(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) throw new PhoneBindingError('UNAUTHORIZED', 401);

  const applicationId = authEnv.AUTH_CASDOOR_APPLICATION_ID?.trim();
  if (!applicationId || !authEnv.AUTH_CASDOOR_ISSUER) {
    throw new PhoneBindingError('PHONE_BINDING_NOT_CONFIGURED', 503);
  }

  const db = await getServerDB();
  const linkedAccount = await db.query.account.findFirst({
    columns: { accessToken: true },
    where: and(eq(account.userId, session.user.id), eq(account.providerId, 'casdoor')),
  });
  if (!linkedAccount?.accessToken) {
    throw new PhoneBindingError('CASDOOR_REAUTH_REQUIRED', 409);
  }

  return {
    accessToken: linkedAccount.accessToken,
    applicationId,
    db,
    issuer: authEnv.AUTH_CASDOOR_ISSUER.replace(/\/+$/, ''),
    sessionToken: session.session.token,
    userId: session.user.id,
  };
};

const parsePhone = (value: unknown) => {
  const phone = normalizeMainlandPhoneE164(typeof value === 'string' ? value : undefined);
  if (!phone) throw new PhoneBindingError('INVALID_PHONE', 400);
  return phone;
};

const assertPhoneAvailable = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
  userId: string,
  phone: string,
) => {
  const owner = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.phone, phone), eq(users.phoneNumberVerified, true), ne(users.id, userId)),
  });
  if (owner) throw new PhoneBindingError('PHONE_IDENTITY_CONFLICT', 409);
};

const callCasdoor = async (
  url: string,
  accessToken: string,
  body: FormData,
  operation: CasdoorOperation,
) => {
  const response = await fetch(url, {
    body,
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept-Language': 'zh-CN' },
    method: 'POST',
  });
  const payload = (await response.json().catch(() => null)) as CasdoorResponse | null;
  if (!response.ok || payload?.status !== 'ok') {
    const message = payload?.msg?.trim().toLowerCase() || '';
    if (message.includes('already exists') || message.includes('手机号已存在')) {
      throw new PhoneBindingError('PHONE_IDENTITY_CONFLICT', 409);
    }
    if (message.includes('phone number is invalid')) {
      throw new PhoneBindingError('INVALID_PHONE', 400);
    }
    if (response.status === 401 || response.status === 403) {
      throw new PhoneBindingError('CASDOOR_REAUTH_REQUIRED', 409);
    }
    if (response.status >= 500) {
      throw new PhoneBindingError('CASDOOR_UPSTREAM_FAILED', 502);
    }
    if (operation === 'send-code') {
      if (
        message.includes('turing test') ||
        message.includes('captcha') ||
        message.includes('验证码还未发送')
      ) {
        throw new PhoneBindingError('CAPTCHA_INVALID', 400);
      }
      if (
        message.includes('frequent') ||
        message.includes('rate limit') ||
        message.includes('resend') ||
        message.includes('too many') ||
        message.includes('频繁') ||
        message.includes('限制')
      ) {
        throw new PhoneBindingError('SMS_RATE_LIMITED', 429);
      }
      throw new PhoneBindingError('SMS_SEND_FAILED', 502);
    }
    if (
      message.includes('verification code') ||
      message.includes('code has already been used') ||
      message.includes('验证码')
    ) {
      throw new PhoneBindingError('SMS_CODE_INVALID', 400);
    }
    throw new PhoneBindingError('CASDOOR_VERIFICATION_FAILED', 502);
  }
};

export const getCasdoorPhoneCaptcha = async (request: Request) => {
  const { accessToken, applicationId, issuer } = await getBindingContext(request);
  const response = await fetch(
    `${issuer}/api/get-captcha?applicationId=${encodeURIComponent(applicationId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const payload = (await response.json().catch(() => null)) as CasdoorCaptchaResponse | null;
  const captcha = payload?.data;
  if (
    !response.ok ||
    payload?.status !== 'ok' ||
    captcha?.type !== 'Default' ||
    !captcha.captchaId ||
    !captcha.captchaImage
  ) {
    throw new PhoneBindingError('CAPTCHA_UNAVAILABLE', 503);
  }

  return {
    captchaId: captcha.captchaId,
    captchaImage: captcha.captchaImage,
    captchaType: captcha.type,
  };
};

export const sendCasdoorPhoneCode = async (
  request: Request,
  phoneValue: unknown,
  captchaIdValue: unknown,
  captchaTokenValue: unknown,
) => {
  const phone = parsePhone(phoneValue);
  const captchaId = typeof captchaIdValue === 'string' ? captchaIdValue.trim() : '';
  const captchaToken = typeof captchaTokenValue === 'string' ? captchaTokenValue.trim() : '';
  if (!captchaId || !captchaToken) throw new PhoneBindingError('CAPTCHA_REQUIRED', 400);
  const { accessToken, applicationId, db, issuer, userId } = await getBindingContext(request);
  await assertPhoneAvailable(db, userId, phone);
  const form = new FormData();
  form.set('applicationId', applicationId);
  form.set('captchaToken', captchaToken);
  form.set('captchaType', 'Default');
  form.set('checkUser', '');
  form.set('clientSecret', captchaId);
  form.set('countryCode', 'CN');
  // Casdoor's send API normalizes the national number using the ISO region code.
  form.set('dest', phone.slice(3));
  form.set('method', 'reset');
  form.set('type', 'phone');
  await callCasdoor(`${issuer}/api/send-verification-code`, accessToken, form, 'send-code');
};

export const confirmCasdoorPhoneCode = async (
  request: Request,
  phoneValue: unknown,
  codeValue: unknown,
) => {
  const phone = parsePhone(phoneValue);
  const code = typeof codeValue === 'string' ? codeValue.trim() : '';
  if (!/^\d{4,8}$/.test(code)) throw new PhoneBindingError('INVALID_CODE', 400);

  const { accessToken, db, issuer, sessionToken, userId } = await getBindingContext(request);
  await assertPhoneAvailable(db, userId, phone);
  const form = new FormData();
  form.set('code', code);
  // The confirmation API has no countryCode field, so it needs full E.164.
  form.set('dest', phone);
  form.set('type', 'phone');
  await callCasdoor(`${issuer}/api/reset-email-or-phone`, accessToken, form, 'confirm-code');

  const result = await new UserModel(db, userId).claimVerifiedPhoneIdentity(phone);
  if (result.status === 'conflict') throw new PhoneBindingError('PHONE_IDENTITY_CONFLICT', 409);
  if (result.status === 'user-not-found') throw new PhoneBindingError('UNAUTHORIZED', 401);

  // The direct atomic claim bypasses Better Auth's adapter, so invalidate its Redis session
  // copy before forcing a DB-backed refresh. Return refreshed cookies to release the phone gate.
  await createSecondaryStorage()?.delete(sessionToken);
  const refreshedSession = await auth.api.getSession({
    asResponse: true,
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!refreshedSession.ok) throw new PhoneBindingError('UNAUTHORIZED', 401);

  return refreshedSession.headers.getSetCookie();
};

export const phoneBindingErrorResponse = (error: unknown) => {
  if (error instanceof PhoneBindingError) {
    return Response.json({ code: error.code }, { status: error.status });
  }
  console.error('[phone-binding] Casdoor phone verification failed');
  return Response.json({ code: 'PHONE_BINDING_FAILED' }, { status: 500 });
};
