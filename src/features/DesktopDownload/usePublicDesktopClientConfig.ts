'use client';

import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { PUBLIC_DESKTOP_UPDATE_SWR_KEY } from './usePublicDesktopDownload';

const trimOrUndefined = (value?: null | string) => {
  const text = value?.trim();
  return text || undefined;
};

export const usePublicDesktopClientConfig = () => {
  const { data } = useClientDataSWR(PUBLIC_DESKTOP_UPDATE_SWR_KEY, () =>
    adminCommercialService.getPublicDesktopUpdate(),
  );

  return useMemo(() => {
    const loginConfig = data?.loginConfig;

    return {
      loginConfig: {
        cloudButtonLabel: trimOrUndefined(loginConfig?.cloudButtonLabel),
        description: trimOrUndefined(loginConfig?.description),
        footerText: trimOrUndefined(loginConfig?.footerText),
        logoUrl: trimOrUndefined(loginConfig?.logoUrl),
        title: trimOrUndefined(loginConfig?.title),
        windowTitle: trimOrUndefined(loginConfig?.windowTitle),
      },
    };
  }, [
    data?.loginConfig?.cloudButtonLabel,
    data?.loginConfig?.description,
    data?.loginConfig?.footerText,
    data?.loginConfig?.logoUrl,
    data?.loginConfig?.title,
    data?.loginConfig?.windowTitle,
  ]);
};
