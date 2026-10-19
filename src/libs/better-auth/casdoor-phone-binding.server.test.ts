/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PhoneBindingError } from './casdoor-phone-binding.server';
import {
  confirmCasdoorPhoneCode,
  getCasdoorPhoneCaptcha,
  sendCasdoorPhoneCode,
} from './casdoor-phone-binding.server';

const mockGetSession = vi.hoisted(() => vi.fn());
const mockFindAccount = vi.hoisted(() => vi.fn());
const mockFindUser = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockDeleteSessionCache = vi.hoisted(() => vi.fn());

vi.mock('@/auth', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_CASDOOR_APPLICATION_ID: 'admin/fab.secsgem.com.cn',
    AUTH_CASDOOR_ISSUER: 'https://auth.secsgem.com.cn',
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://fab.secsgem.com.cn' } }));
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({
    query: {
      account: { findFirst: mockFindAccount },
      users: { findFirst: mockFindUser },
    },
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    claimVerifiedPhoneIdentity = mockClaim;
  },
}));
vi.mock('@/libs/better-auth/utils/config', () => ({
  createSecondaryStorage: () => ({ delete: mockDeleteSessionCache }),
}));

const request = (origin = 'https://fab.secsgem.com.cn') =>
  new Request('https://fab.secsgem.com.cn/api/auth/phone-binding', {
    headers: { origin },
    method: 'POST',
  });
const sendCode = (phone = '13800138000') =>
  sendCasdoorPhoneCode(request(), phone, 'captcha-id', 'ABCD');

const expectCode = async (promise: Promise<unknown>, code: string, status: number) => {
  await expect(promise).rejects.toMatchObject<Partial<PhoneBindingError>>({ code, status });
};

describe('Casdoor phone binding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetSession.mockImplementation(async (options) =>
      options?.asResponse
        ? new Response(null, { headers: { 'set-cookie': 'session=fresh; Path=/' } })
        : { session: { token: 'session-token' }, user: { id: 'user-a' } },
    );
    mockFindAccount.mockResolvedValue({ accessToken: 'server-only-token' });
    mockFindUser.mockResolvedValue(undefined);
    mockClaim.mockResolvedValue({ status: 'claimed' });
  });

  it('rejects unauthenticated requests', async () => {
    mockGetSession.mockResolvedValue(null);
    await expectCode(sendCode(), 'UNAUTHORIZED', 401);
  });

  it('rejects cross-origin requests before reading the session', async () => {
    await expectCode(
      sendCasdoorPhoneCode(request('https://evil.example'), '13800138000', 'captcha-id', 'ABCD'),
      'INVALID_ORIGIN',
      403,
    );
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('accepts the configured public origin behind an internal HTTP reverse proxy', async () => {
    const proxiedRequest = new Request(
      'http://fab125-comhub-1:3210/api/auth/phone-binding/send-code',
      { headers: { origin: 'https://fab.secsgem.com.cn' }, method: 'POST' },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'ok' }));

    await expect(
      sendCasdoorPhoneCode(proxiedRequest, '13800138000', 'captcha-id', 'ABCD'),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid mainland phone', async () => {
    await expectCode(sendCode('123'), 'INVALID_PHONE', 400);
  });

  it('rejects a phone already verified by another Fab user before calling Casdoor', async () => {
    mockFindUser.mockResolvedValue({ id: 'user-b' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expectCode(
      sendCode(),
      'PHONE_IDENTITY_CONFLICT',
      409,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps an incorrect SMS code without exposing the upstream response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: 'verification code is wrong', status: 'error' }),
    );
    await expectCode(
      confirmCasdoorPhoneCode(request(), '13800138000', '123456'),
      'SMS_CODE_INVALID',
      400,
    );
  });

  it.each([401, 403])('requires Casdoor reauthentication on upstream %s', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'error' }, { status }));
    await expectCode(
      sendCode(),
      'CASDOOR_REAUTH_REQUIRED',
      409,
    );
  });

  it('maps Casdoor 5xx to a distinct upstream failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ status: 'error' }, { status: 503 }),
    );
    await expectCode(
      sendCode(),
      'CASDOOR_UPSTREAM_FAILED',
      502,
    );
  });

  it('distinguishes an invalid Default captcha from SMS delivery failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: 'Turing test failed.', status: 'error' }),
    );
    await expectCode(sendCode(), 'CAPTCHA_INVALID', 400);
  });

  it('maps the Casdoor Chinese invalid captcha response to a client error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: '验证码还未发送', status: 'error' }),
    );
    await expectCode(sendCode(), 'CAPTCHA_INVALID', 400);
  });

  it('distinguishes SMS rate limiting from an invalid captcha', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: 'Requests are too frequent, please resend later', status: 'error' }),
    );
    await expectCode(sendCode(), 'SMS_RATE_LIMITED', 429);
  });

  it('maps Casdoor invalid phone errors to a client error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: 'Phone number is invalid', status: 'error' }),
    );
    await expectCode(sendCode(), 'INVALID_PHONE', 400);
  });

  it('maps a Casdoor Chinese phone conflict to an explicit conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ msg: '该手机号已存在', status: 'error' }),
    );
    await expectCode(
      confirmCasdoorPhoneCode(request(), '13800138000', '123456'),
      'PHONE_IDENTITY_CONFLICT',
      409,
    );
  });

  it('uses Casdoor native SMS/reset APIs and claims the verified Fab identity', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ status: 'ok' }));

    await sendCode();
    const sessionCookies = await confirmCasdoorPhoneCode(request(), '13800138000', '123456');

    const sendBody = fetchSpy.mock.calls[0][1]?.body as FormData;
    const confirmBody = fetchSpy.mock.calls[1][1]?.body as FormData;
    expect(sendBody.get('countryCode')).toBe('CN');
    expect(sendBody.get('dest')).toBe('13800138000');
    expect(sendBody.get('method')).toBe('reset');
    expect(sendBody.get('captchaType')).toBe('Default');
    expect(sendBody.get('captchaToken')).toBe('ABCD');
    expect(sendBody.get('clientSecret')).toBe('captcha-id');
    expect(confirmBody.get('dest')).toBe('+8613800138000');
    expect(confirmBody.get('code')).toBe('123456');
    expect(mockClaim).toHaveBeenCalledWith('+8613800138000');
    expect(mockDeleteSessionCache).toHaveBeenCalledWith('session-token');
    expect(mockGetSession).toHaveBeenLastCalledWith({
      asResponse: true,
      headers: expect.any(Headers),
      query: { disableCookieCache: true },
    });
    expect(sessionCookies).toEqual(['session=fresh; Path=/']);
  });

  it('returns the Casdoor Default captcha without exposing provider secrets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        data: { captchaId: 'captcha-id', captchaImage: 'base64-image', type: 'Default' },
        status: 'ok',
      }),
    );

    await expect(getCasdoorPhoneCaptcha(request())).resolves.toEqual({
      captchaId: 'captcha-id',
      captchaImage: 'base64-image',
      captchaType: 'Default',
    });
  });
});
