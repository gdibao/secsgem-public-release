export const DESKTOP_DEFAULT_BUSINESS_SERVER_URL = 'https://fab.secsgem.com.cn';

export const DESKTOP_UPDATE_SETTING_KEYS = {
  desktopDownloadLabel: 'desktop.download.label',
  desktopDownloadUrl: 'desktop.download.url',
  desktopLoginCloudButtonLabel: 'desktop.login.cloudButtonLabel',
  desktopLoginDescription: 'desktop.login.description',
  desktopLoginFooterText: 'desktop.login.footerText',
  desktopLoginLogoUrl: 'desktop.login.logoUrl',
  desktopLoginTitle: 'desktop.login.title',
  desktopLoginWindowTitle: 'desktop.login.windowTitle',
  desktopOssAccessKeyId: 'desktop.oss.accessKeyId',
  desktopOssAccessKeySecret: 'desktop.oss.accessKeySecret',
  desktopOssBucket: 'desktop.oss.bucket',
  desktopOssEndpoint: 'desktop.oss.endpoint',
  desktopOssPath: 'desktop.oss.path',
  desktopUpdateAutoCheck: 'desktop.update.autoCheck',
  desktopUpdateChannel: 'desktop.update.channel',
  desktopUpdateCheckInterval: 'desktop.update.checkInterval',
  desktopUpdateCurrentVersion: 'desktop.update.currentVersion',
  desktopUpdateReleaseNotes: 'desktop.update.releaseNotes',
  desktopUpdateServerUrl: 'desktop.update.serverUrl',
} as const;

export const DESKTOP_SETTINGS_SECTIONS = [
  { key: 'overview', readonly: true, title: 'Overview' },
  { key: 'distribution', readonly: false, title: 'Installation and distribution' },
  { key: 'updates', readonly: false, title: 'Update settings' },
  { key: 'brand', readonly: false, title: 'Brand and login' },
] as const;
