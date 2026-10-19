import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSignUp } from './useSignUp';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSearchParamsGet = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockMessageError = vi.hoisted(() => vi.fn());
const mockSignUpEmail = vi.hoisted(() => vi.fn());
const mockSignInOauth2 = vi.hoisted(() => vi.fn());
const mockGetCaptchaTokenOnError = vi.hoisted(() => vi.fn());
const mockPreSocialSignupCheck = vi.hoisted(() => vi.fn(async () => true));

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [{ get: mockSearchParamsGet }],
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mockMessageError, success: vi.fn() },
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  signIn: { oauth2: mockSignInOauth2 },
  signUp: { email: mockSignUpEmail },
}));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BRANDING_LOGO_URL: '',
  BRANDING_NAME: 'LobeHub',
  ORG_NAME: 'LobeHub',
}));

vi.mock('@/business/client/hooks/useBusinessSignup', () => ({
  useBusinessSignup: () => ({
    businessElement: null,
    getCaptchaTokenOnError: mockGetCaptchaTokenOnError,
    getFetchOptions: async () => undefined,
    preSocialSignupCheck: mockPreSocialSignupCheck,
  }),
}));

let mockEnableEmailVerification = false;
let mockEnableBusinessFeatures = false;
vi.mock('@/features/AuthShell/AuthServerConfigProvider', () => ({
  useAuthServerConfigStore: (selector: (s: any) => any) =>
    selector({
      serverConfig: {
        enableBusinessFeatures: mockEnableBusinessFeatures,
        enableEmailVerification: mockEnableEmailVerification,
      },
    }),
}));

const originalLocation = window.location;

describe('useSignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockGetCaptchaTokenOnError.mockResolvedValue(undefined);
    mockPreSocialSignupCheck.mockResolvedValue(true);
    mockEnableBusinessFeatures = false;
    mockEnableEmailVerification = false;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '', origin: originalLocation.origin },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('starts the Casdoor WeChat flow with phone binding as both callbacks', async () => {
    mockSignInOauth2.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSignUp());

    await act(async () => result.current.onWechatSignUp());

    expect(mockSignInOauth2).toHaveBeenCalledWith({
      callbackURL: `${originalLocation.origin}/bind-phone?callbackUrl=%2F`,
      newUserCallbackURL: `${originalLocation.origin}/bind-phone?callbackUrl=%2F`,
      providerId: 'casdoor',
    });
  });

  describe('initial state', () => {
    it('should return initial values', () => {
      const { result } = renderHook(() => useSignUp());

      expect(result.current.loading).toBe(false);
      expect(result.current.onSubmit).toBeInstanceOf(Function);
    });
  });

  describe('handleSignUp', () => {
    const validValues = {
      confirmPassword: 'Password123!',
      email: 'new@example.com',
      password: 'Password123!',
    };

    it('should call signUp.email with correct params', async () => {
      mockSignUpEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockSignUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          name: 'new',
          password: 'Password123!',
        }),
      );
    });

    it('should stop sign up when business pre-check rejects', async () => {
      mockEnableBusinessFeatures = true;
      mockPreSocialSignupCheck.mockResolvedValue(false);

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockPreSocialSignupCheck).toHaveBeenCalledWith(validValues);
      expect(mockSignUpEmail).not.toHaveBeenCalled();
    });

    it('should redirect to onboarding on success', async () => {
      mockSignUpEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(window.location.href).toBe('/bind-phone?callbackUrl=%2Fonboarding');
    });

    it('should thread callbackUrl from search params through onboarding', async () => {
      mockSearchParamsGet.mockImplementation((key: string) =>
        key === 'callbackUrl' ? '/dashboard' : null,
      );
      mockSignUpEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockSignUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: `${originalLocation.origin}/bind-phone?callbackUrl=%2Fonboarding%3FcallbackUrl%3D%252Fdashboard`,
        }),
      );
      expect(window.location.href).toBe(
        '/bind-phone?callbackUrl=%2Fonboarding%3FcallbackUrl%3D%252Fdashboard',
      );
    });

    it('should redirect to verify-email when email verification is enabled', async () => {
      mockEnableEmailVerification = true;
      mockSignUpEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        '/verify-email?email=new%40example.com&callbackUrl=%2Fbind-phone%3FcallbackUrl%3D%252Fonboarding',
      );
    });

    it('should derive username from email prefix', async () => {
      mockSignUpEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit({ ...validValues, email: 'john.doe@gmail.com' });
      });

      expect(mockSignUpEmail).toHaveBeenCalledWith(expect.objectContaining({ name: 'john.doe' }));
    });

    it('should show error for duplicate email', async () => {
      mockSignUpEmail.mockResolvedValue({
        error: {
          code: 'FAILED_TO_CREATE_USER',
          details: { cause: { code: '23505' } },
        },
      });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(window.location.href).toBe('');
    });

    it('should show error for invalid email', async () => {
      mockSignUpEmail.mockResolvedValue({
        error: { code: 'INVALID_EMAIL', message: 'Invalid email' },
      });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(window.location.href).toBe('');
    });

    it('should show translated error for known error codes', async () => {
      mockSignUpEmail.mockResolvedValue({
        error: { code: 'SOME_KNOWN_CODE', message: 'fallback msg' },
      });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(window.location.href).toBe('');
    });

    it('should retry sign up with captcha token when captcha is required', async () => {
      mockGetCaptchaTokenOnError.mockResolvedValue('captcha-token');
      mockSignUpEmail
        .mockResolvedValueOnce({
          error: { code: 'CAPTCHA_REQUIRED', message: 'Missing CAPTCHA response' },
        })
        .mockResolvedValueOnce({ error: null });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockSignUpEmail).toHaveBeenCalledTimes(2);
      expect(mockSignUpEmail).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fetchOptions: { headers: { 'x-captcha-response': 'captcha-token' } },
        }),
      );
      expect(mockMessageError).not.toHaveBeenCalled();
      expect(window.location.href).toBe('/bind-phone?callbackUrl=%2Fonboarding');
    });

    it('should stop sign up when captcha modal is cancelled', async () => {
      mockGetCaptchaTokenOnError.mockResolvedValue(null);
      mockSignUpEmail.mockResolvedValue({
        error: { code: 'CAPTCHA_REQUIRED', message: 'Missing CAPTCHA response' },
      });

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
      expect(mockMessageError).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(window.location.href).toBe('');
    });

    it('should show generic error on unexpected exception', async () => {
      mockSignUpEmail.mockRejectedValue(new Error('network error'));

      const { result } = renderHook(() => useSignUp());

      await act(async () => {
        await result.current.onSubmit(validValues);
      });

      expect(mockMessageError).toHaveBeenCalled();
    });

    it('should set loading during sign up and reset after', async () => {
      let resolveSignUp: (v: any) => void;
      mockSignUpEmail.mockReturnValue(
        new Promise((resolve) => {
          resolveSignUp = resolve;
        }),
      );

      const { result } = renderHook(() => useSignUp());

      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.onSubmit(validValues);
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveSignUp!({ error: null });
        await submitPromise!;
      });

      expect(result.current.loading).toBe(false);
    });
  });
});
