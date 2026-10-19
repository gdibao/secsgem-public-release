'use client';

import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { resolveDesktopDownloadEntry } from './resolveDesktopDownloadEntry';

export const PUBLIC_DESKTOP_UPDATE_SWR_KEY = ['public-desktop-update'];

export const usePublicDesktopDownload = ({
  fallbackLabel,
  isAndroid,
  isIOS,
}: {
  fallbackLabel: string;
  isAndroid?: boolean;
  isIOS?: boolean;
}) => {
  const { data } = useClientDataSWR(PUBLIC_DESKTOP_UPDATE_SWR_KEY, () =>
    adminCommercialService.getPublicDesktopUpdate(),
  );

  return useMemo(
    () =>
      resolveDesktopDownloadEntry({
        config: data,
        fallbackLabel,
        isAndroid,
        isIOS,
      }),
    [
      data?.currentVersion,
      data?.downloadLabel,
      data?.downloadUrl,
      data?.releaseNotes,
      fallbackLabel,
      isAndroid,
      isIOS,
    ],
  );
};
