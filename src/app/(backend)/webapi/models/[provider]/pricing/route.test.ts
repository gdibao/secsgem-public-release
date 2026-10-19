// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { AiProviderModel } from '@/database/models/aiProvider';

import { GET } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/database/models/aiProvider', () => {
  const mockGetAiProviderById = vi.fn();

  return {
    AiProviderModel: vi.fn(function () {
      return { getAiProviderById: mockGetAiProviderById };
    }),
  };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
  },
}));

const mockSsrfSafeFetch = vi.fn();
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

let request: Request;

beforeEach(() => {
  request = new Request(new URL('https://test.com'), { method: 'GET' });
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const providerConfig = (baseURL: string, apiKey = 'test-key') =>
  ({ keyVaults: { apiKey, baseURL } }) as any;

describe('GET /webapi/models/[provider]/pricing', () => {
  it('returns ContentNotFound if provider config is missing', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(undefined);

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(404);
    expect(responseBody.errorType).toBe(ChatErrorType.ContentNotFound);
  });

  it('returns BadRequest if baseURL is missing', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: { apiKey: 'test-key' },
    } as any);

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody.errorType).toBe(ChatErrorType.BadRequest);
  });

  it('fetches pricing with the provider key and strips the API version', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('https://newapi.test.com/v1'),
    );
    mockSsrfSafeFetch.mockResolvedValue({
      json: async () => ({ data: [{ model_name: 'test' }], success: true }),
      ok: true,
    });

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{ model_name: 'test' }],
      success: true,
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://newapi.test.com/api/pricing',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json; charset=utf-8',
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('uses the requested custom provider configuration', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('https://custom-newapi.test.com/v1', 'custom-key'),
    );
    mockSsrfSafeFetch.mockResolvedValue({
      json: async () => ({ data: [{ model_name: 'custom-model' }], success: true }),
      ok: true,
    });

    const response = await GET(request, {
      params: Promise.resolve({ provider: 'custom-router' }),
    });

    expect(response.status).toBe(200);
    expect(mockModelInstance.getAiProviderById).toHaveBeenCalledWith(
      'custom-router',
      expect.any(Function),
    );
    await expect(response.json()).resolves.toEqual({
      data: [{ model_name: 'custom-model' }],
      success: true,
    });
  });

  it('falls back to an unauthenticated request when the authenticated request throws', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('https://newapi.test.com/v1'),
    );
    mockSsrfSafeFetch.mockRejectedValueOnce(new Error('Auth fetch failed')).mockResolvedValueOnce({
      json: async () => ({ data: [{ model_name: 'test' }], success: true }),
      ok: true,
    });

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });

    expect(response.status).toBe(200);
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockSsrfSafeFetch).toHaveBeenNthCalledWith(
      2,
      'https://newapi.test.com/api/pricing',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it('falls back to an unauthenticated request when the authenticated response is not ok', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('https://newapi.test.com/v1'),
    );
    mockSsrfSafeFetch.mockResolvedValueOnce({ ok: false, statusText: 'Unauthorized' }).mockResolvedValueOnce({
      json: async () => ({ data: [{ model_name: 'test' }], success: true }),
      ok: true,
    });

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });

    expect(response.status).toBe(200);
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
  });

  it('returns BadGateway if the provider remains unavailable', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('https://newapi.test.com/v1'),
    );
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, statusText: 'Bad Gateway' });

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(502);
    expect(responseBody.errorType).toBe(ChatErrorType.BadGateway);
  });

  it('returns InternalServerError if SSRF protection blocks the request', async () => {
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(
      providerConfig('http://192.168.1.1/v1'),
    );
    mockSsrfSafeFetch.mockRejectedValue(
      new Error('SSRF blocked: http://192.168.1.1 is not allowed.'),
    );

    const response = await GET(request, { params: Promise.resolve({ provider: 'newapi' }) });
    const responseBody = await response.json();

    expect(response.status).toBe(500);
    expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
  });
});
