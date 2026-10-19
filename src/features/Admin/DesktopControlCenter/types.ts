import type { KeyedMutator } from 'swr';

import type { adminCommercialService, AdminSettingsSectionData } from '@/services/adminCommercial';

export const DESKTOP_CONTROL_CENTER_TABS = [
  'overview',
  'distribution',
  'updates',
  'brand',
  'build-profile',
] as const;

export type DesktopControlCenterTab = (typeof DESKTOP_CONTROL_CENTER_TABS)[number];

export type DesktopOverviewData = Awaited<
  ReturnType<typeof adminCommercialService.getDesktopOverview>
>;
export type DesktopSettingsData = AdminSettingsSectionData<'desktop-update'>;
export type DesktopChannel = DesktopOverviewData['diagnostics']['channels'][number]['channel'];
export type DesktopPlatform =
  keyof DesktopOverviewData['diagnostics']['channels'][number]['platforms'];
export type DesktopDiagnosticReason = NonNullable<
  DesktopOverviewData['diagnostics']['channels'][number]['platforms'][DesktopPlatform]['reason']
>;

export const DESKTOP_CHANNEL_LABEL_KEYS = {
  canary: 'admin.desktopControl.status.canary',
  stable: 'admin.desktopControl.status.stable',
} as const satisfies Record<DesktopChannel, string>;

export const DESKTOP_PLATFORM_LABEL_KEYS = {
  'linux': 'admin.desktopControl.platforms.linux',
  'mac-arm': 'admin.desktopControl.platforms.macArm',
  'mac-intel': 'admin.desktopControl.platforms.macIntel',
  'windows': 'admin.desktopControl.platforms.windows',
} as const satisfies Record<DesktopPlatform, string>;

export const DESKTOP_REASON_LABEL_KEYS = {
  'credentials-not-allowed': 'admin.desktopControl.reason.credentialsNotAllowed',
  'https-required': 'admin.desktopControl.reason.httpsRequired',
  'installer-missing': 'admin.desktopControl.reason.installerMissing',
  'invalid-url': 'admin.desktopControl.reason.invalidUrl',
  'manifest-invalid': 'admin.desktopControl.reason.manifestInvalid',
  'manifest-request-failed': 'admin.desktopControl.reason.manifestRequestFailed',
  'manifest-too-large': 'admin.desktopControl.reason.manifestTooLarge',
  'manifest-version-missing': 'admin.desktopControl.reason.manifestVersionMissing',
  'request-timeout': 'admin.desktopControl.reason.requestTimeout',
  'unsafe-url': 'admin.desktopControl.reason.unsafeUrl',
} as const satisfies Record<DesktopDiagnosticReason, string>;

export interface DesktopResource<Data> {
  data?: Data;
  error?: unknown;
  isLoading: boolean;
  mutate: KeyedMutator<Data>;
}

export type DesktopOverviewResource = DesktopResource<DesktopOverviewData>;
export type DesktopSettingsResource = DesktopResource<DesktopSettingsData>;

export const resolveDesktopControlCenterTab = (value: null | string): DesktopControlCenterTab =>
  DESKTOP_CONTROL_CENTER_TABS.includes(value as DesktopControlCenterTab)
    ? (value as DesktopControlCenterTab)
    : 'overview';
