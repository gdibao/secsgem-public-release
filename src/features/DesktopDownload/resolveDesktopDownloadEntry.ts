import { DOWNLOAD_URL } from '@lobechat/const';

export interface PublicDesktopDownloadConfig {
  currentVersion?: null | string;
  downloadLabel?: null | string;
  downloadUrl?: null | string;
  releaseNotes?: null | string;
}

export interface DesktopDownloadEntry {
  currentVersion: null | string;
  label: string;
  releaseNotes: null | string;
  url: string;
}

const cleanText = (value?: null | string) => {
  const text = value?.trim();
  return text || null;
};

export const resolveDesktopDownloadEntry = ({
  config,
  fallbackLabel,
  isAndroid,
  isIOS,
}: {
  config?: null | PublicDesktopDownloadConfig;
  fallbackLabel: string;
  isAndroid?: boolean;
  isIOS?: boolean;
}): DesktopDownloadEntry => {
  let fallbackUrl = DOWNLOAD_URL.default;
  if (isIOS) fallbackUrl = DOWNLOAD_URL.ios;
  else if (isAndroid) fallbackUrl = DOWNLOAD_URL.android;

  return {
    currentVersion: cleanText(config?.currentVersion),
    label: cleanText(config?.downloadLabel) || fallbackLabel,
    releaseNotes: cleanText(config?.releaseNotes),
    url: cleanText(config?.downloadUrl) || fallbackUrl,
  };
};
