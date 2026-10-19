import { describe, expect, it } from 'vitest';

import {
  assertSafeModuleAppApiUrl,
  createModuleAppPinnedLookup,
  isSafeModuleAppApiUrl,
  resolveSafeModuleAppApiUrl,
} from './safeUrl';

describe('module app safe URL validation', () => {
  it('keeps the sync compatibility helper for simple public URLs', () => {
    expect(isSafeModuleAppApiUrl('https://api.example.com/v1')).toBe(true);
    expect(isSafeModuleAppApiUrl('ftp://api.example.com/v1')).toBe(false);
    expect(isSafeModuleAppApiUrl('http://localhost:3000')).toBe(false);
  });

  it('rejects credentials and DNS results pointing to private addresses', async () => {
    await expect(
      assertSafeModuleAppApiUrl('https://user:pass@example.com/v1', {
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('MODULE_APP_UNSAFE_API_URL');

    await expect(
      assertSafeModuleAppApiUrl('https://api.example.com/v1', {
        resolveHostname: () => ['127.0.0.1'],
      }),
    ).rejects.toThrow('MODULE_APP_UNSAFE_API_URL');
  });

  it('normalizes safe public URLs after DNS verification', async () => {
    await expect(
      assertSafeModuleAppApiUrl('https://api.example.com/v1', {
        resolveHostname: () => ['93.184.216.34'],
      }),
    ).resolves.toBe('https://api.example.com/v1');
  });

  it('returns vetted addresses and pins connection lookup to that exact result', async () => {
    const resolved = await resolveSafeModuleAppApiUrl('https://api.example.com/v1', {
      resolveHostname: () => ['93.184.216.34'],
    });
    expect(resolved).toEqual({
      addresses: ['93.184.216.34'],
      hostname: 'api.example.com',
      url: 'https://api.example.com/v1',
    });

    const pinnedLookup = createModuleAppPinnedLookup(resolved);
    await expect(
      new Promise((resolve, reject) => {
        pinnedLookup('api.example.com', { all: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      }),
    ).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      new Promise((resolve, reject) => {
        pinnedLookup('rebound.example.com', { all: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      }),
    ).rejects.toThrow('MODULE_APP_UNSAFE_API_URL');
  });
});
