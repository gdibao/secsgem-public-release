import { afterEach, describe, expect, it, vi } from 'vitest';

const originalOfficialCloudServer = process.env.OFFICIAL_CLOUD_SERVER;
const originalDeviceGatewayUrl = process.env.DEVICE_GATEWAY_URL;

const reloadDesktopEnv = async () => {
  vi.resetModules();
  return import('./env');
};

afterEach(() => {
  if (originalOfficialCloudServer === undefined) {
    delete process.env.OFFICIAL_CLOUD_SERVER;
  } else {
    process.env.OFFICIAL_CLOUD_SERVER = originalOfficialCloudServer;
  }
  if (originalDeviceGatewayUrl === undefined) {
    delete process.env.DEVICE_GATEWAY_URL;
  } else {
    process.env.DEVICE_GATEWAY_URL = originalDeviceGatewayUrl;
  }
  vi.resetModules();
});

describe('desktop env defaults', () => {
  it('defaults the official cloud server to Fab', async () => {
    delete process.env.OFFICIAL_CLOUD_SERVER;

    const { getDesktopEnv } = await reloadDesktopEnv();

    expect(getDesktopEnv().OFFICIAL_CLOUD_SERVER).toBe('https://fab.secsgem.com.cn');
    expect(getDesktopEnv().DESKTOP_APPLICATION_ID).toBe('com.gdibao.chituoai');
    expect(getDesktopEnv().DESKTOP_APPLICATION_NAME).toBe('驰拓 AI 助手');
    expect(getDesktopEnv().DESKTOP_OIDC_CLIENT_ID).toBe('lobehub-desktop');
    expect(getDesktopEnv().DESKTOP_PROTOCOL_SCHEME).toBe('chituoai');
  });

  it('allows release builds to override the official cloud server', async () => {
    process.env.OFFICIAL_CLOUD_SERVER = 'https://desktop.example.com';

    const { getDesktopEnv } = await reloadDesktopEnv();

    expect(getDesktopEnv().OFFICIAL_CLOUD_SERVER).toBe('https://desktop.example.com');
  });

  it('reads the release-configured device gateway URL', async () => {
    process.env.DEVICE_GATEWAY_URL = 'https://desktop.example.com/device-gateway';

    const { getDesktopEnv } = await reloadDesktopEnv();

    expect(getDesktopEnv().DEVICE_GATEWAY_URL).toBe(
      'https://desktop.example.com/device-gateway',
    );
  });
});
