export type DesktopBuildAssetKind = 'appPreview' | 'nsisHeader' | 'nsisSidebar' | 'windowsIcon';

export type DesktopBuildProfileRevisionState = 'draft' | 'frozen';

export type DesktopReleaseChannel = 'canary' | 'stable';

export type DesktopReleaseStatus = 'building' | 'failed' | 'publishing' | 'queued' | 'succeeded';

export interface DesktopBuildAsset {
  contentType: string;
  height?: number;
  key: string;
  kind: DesktopBuildAssetKind;
  sha256: string;
  size: number;
  width?: number;
}

export type DesktopBuildAssetManifest = Record<DesktopBuildAssetKind, DesktopBuildAsset>;

export interface DesktopBuildProfilePayload {
  applicationId: string;
  applicationName: string;
  description: string;
  executableName: string;
  homepage: string;
  installerArtifactName: string;
  protocolScheme: string;
  publisher: string;
  shortcutName: string;
  uninstallDisplayName: string;
}
