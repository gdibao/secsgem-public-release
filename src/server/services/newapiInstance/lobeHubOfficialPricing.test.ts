// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLobeHubOfficialModelPricing,
  invalidateLobeHubOfficialPricingCache,
} from './lobeHubOfficialPricing';

const officialPricing = {
  units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
};

describe('getLobeHubOfficialModelPricing', () => {
  beforeEach(() => {
    invalidateLobeHubOfficialPricingCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads, validates, caches, and exactly matches the official model catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ id: 'gpt-official', pricing: officialPricing }],
          updatedAt: '2026-08-07T03:28:32.551Z',
          version: 2,
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLobeHubOfficialModelPricing('gpt-official')).resolves.toEqual(officialPricing);
    await expect(getLobeHubOfficialModelPricing('same-name-on-another-provider')).resolves.toBe(
      undefined,
    );
    await expect(getLobeHubOfficialModelPricing('gpt-official')).resolves.toEqual(officialPricing);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.lobehub.com/webapi/lobehub-model-config',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('matches a dated provider snapshot to its canonical official model price', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [{ id: 'deepseek-v4-flash', pricing: officialPricing }],
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        ),
      ),
    );

    await expect(getLobeHubOfficialModelPricing('deepseek-v4-flash-0731')).resolves.toEqual(
      officialPricing,
    );
  });

  it('rejects malformed official pricing instead of trusting it for billing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              {
                id: 'invalid-price',
                pricing: {
                  units: [
                    {
                      name: 'textInput',
                      rate: -1,
                      strategy: 'fixed',
                      unit: 'millionTokens',
                    },
                  ],
                },
              },
              { id: 'still-valid', pricing: officialPricing },
            ],
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        ),
      ),
    );

    await expect(getLobeHubOfficialModelPricing('invalid-price')).resolves.toBeUndefined();
    await expect(getLobeHubOfficialModelPricing('still-valid')).resolves.toEqual(officialPricing);
  });

  it('uses a recent cached catalog when the official endpoint is temporarily unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [{ id: 'gpt-official', pricing: officialPricing }] }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      )
      .mockRejectedValueOnce(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLobeHubOfficialModelPricing('gpt-official')).resolves.toEqual(officialPricing);
    vi.setSystemTime(new Date('2026-08-08T02:00:00.000Z'));
    await expect(getLobeHubOfficialModelPricing('gpt-official')).resolves.toEqual(officialPricing);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
