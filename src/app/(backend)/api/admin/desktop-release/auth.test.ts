// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTING_KEYS } from '@/server/services/appSettings';
import {
  APP_SETTING_SECRET_PREFIX,
  encryptAppSettingSecret,
} from '@/server/services/appSettings/secrets';

import { isDesktopReleaseAuthorized, resolveDesktopReleaseToken } from './auth';

const timingSafeEqual = vi.hoisted(() =>
  vi.fn<(actual: Buffer, expected: Buffer) => boolean>(() => true),
);

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal()),
  timingSafeEqual,
}));

const TEST_KEY_VAULTS_SECRET = Buffer.alloc(32, 17).toString('base64');
const createDb = (value: unknown = 'legacy-secret') =>
  ({
    query: {
      appSettings: {
        findFirst: vi.fn().mockResolvedValue({ value }),
      },
    },
  }) as any;

describe('desktop release authentication', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE;
    delete process.env.CRON_SECRET;
    delete process.env.DESKTOP_RELEASE_TOKEN;
    delete process.env.KEY_VAULTS_SECRET;
  });

  it('uses the dedicated token before an enabled legacy bridge', async () => {
    process.env.DESKTOP_RELEASE_TOKEN = 'dedicated-secret';
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';

    await expect(resolveDesktopReleaseToken(createDb('legacy-secret'))).resolves.toBe(
      'dedicated-secret',
    );
  });

  it('allows encrypted cron.secret only through the explicit legacy bridge', async () => {
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';
    process.env.KEY_VAULTS_SECRET = TEST_KEY_VAULTS_SECRET;
    const encrypted = await encryptAppSettingSecret(APP_SETTING_KEYS.cronSecret, 'legacy-secret');

    await expect(resolveDesktopReleaseToken(createDb(encrypted))).resolves.toBe('legacy-secret');
  });

  it('fails closed for an invalid encrypted legacy value without falling back to CRON_SECRET', async () => {
    process.env.ALLOW_LEGACY_CRON_SECRET_FOR_DESKTOP_RELEASE = '1';
    process.env.CRON_SECRET = 'environment-secret';

    await expect(
      resolveDesktopReleaseToken(
        createDb(`${APP_SETTING_SECRET_PREFIX}${APP_SETTING_KEYS.cronSecret}:invalid`),
      ),
    ).rejects.toThrow();
  });

  it('uses timingSafeEqual for equal-length buffers and rejects wrong or mismatched tokens safely', () => {
    expect(isDesktopReleaseAuthorized('dedicated-secret', 'dedicated-secret')).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const [actual, expected] = timingSafeEqual.mock.calls[0];
    expect(actual).toBeInstanceOf(Buffer);
    expect(expected).toBeInstanceOf(Buffer);
    expect(actual.byteLength).toBe(expected.byteLength);

    timingSafeEqual.mockReturnValueOnce(false);
    expect(isDesktopReleaseAuthorized('incorrect-secret', 'dedicated-secret')).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);

    expect(isDesktopReleaseAuthorized('short', 'dedicated-secret')).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
  });
});
