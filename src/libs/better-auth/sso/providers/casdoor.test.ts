import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_CASDOOR_ID: 'casdoor-client-id',
    AUTH_CASDOOR_ISSUER: 'https://auth.secsgem.com.cn',
    AUTH_CASDOOR_SECRET: 'casdoor-client-secret',
    AUTH_SECRET: 'fab-auth-secret',
  },
}));

describe('Casdoor SSO provider', () => {
  it('uses a verified provider email when one exists', async () => {
    const { default: provider } = await import('./casdoor');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Casdoor test environment is incomplete');
    const config = provider.build(env);

    expect(config.authorizationUrlParams).toBeUndefined();
    expect(config.scopes).toContain('phone');
    expect(config.overrideUserInfo).toBe(true);

    const mapped = await config.mapProfileToUser?.({
      displayName: '测试用户',
      email: 'USER@EXAMPLE.COM',
      emailVerified: true,
      id: 'casdoor-subject',
    } as never);

    expect(mapped).toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
      name: '测试用户',
    });
  });

  it('maps a phone or WeChat identity to a hidden non-deliverable email', async () => {
    const { default: provider } = await import('./casdoor');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Casdoor test environment is incomplete');
    const config = provider.build(env);

    const mapped = await config.mapProfileToUser?.({
      displayName: '微信用户',
      id: 'wechat-open-id',
    } as never);

    expect(mapped).toMatchObject({
      emailVerified: false,
      name: '微信用户',
    });
    expect(mapped?.email).toMatch(/^casdoor-[a-f0-9]{32}@identity\.gdibao\.invalid$/);
    expect(mapped?.email).not.toContain('wechat-open-id');
  });

  it('maps a Casdoor-verified mainland phone to the canonical identity key', async () => {
    const { default: provider } = await import('./casdoor');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Casdoor test environment is incomplete');
    const config = provider.build(env);

    const mapped = await config.mapProfileToUser?.({
      displayName: '手机用户',
      id: 'phone-subject',
      phone: '138 0013 8000',
    } as never);

    expect(mapped).toMatchObject({
      phone: '+8613800138000',
      phoneNumberVerified: true,
    });
  });

  it('does not mark an invalid or missing phone as verified', async () => {
    const { default: provider } = await import('./casdoor');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Casdoor test environment is incomplete');
    const config = provider.build(env);

    const mapped = await config.mapProfileToUser?.({
      displayName: '微信用户',
      id: 'invalid-phone-subject',
      phone: 'not-a-phone',
    } as never);

    expect(mapped).toMatchObject({ phoneNumberVerified: false });
    expect(mapped).not.toHaveProperty('phone');
  });

  it('rejects a profile without a stable Casdoor subject', async () => {
    const { default: provider } = await import('./casdoor');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Casdoor test environment is incomplete');
    const config = provider.build(env);

    expect(() => config.mapProfileToUser?.({ displayName: '无标识用户' } as never)).toThrow(
      'Casdoor profile is missing its subject',
    );
  });
});
