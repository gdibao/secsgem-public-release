'use client';

import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useProviderSettingsNavigate = () => {
  const navigate = useWorkspaceAwareNavigate();
  const isMobile = useServerConfigStore(serverConfigSelectors.isMobile);

  return useCallback(
    (providerKey: string) => {
      const path = `/settings/provider/${providerKey}`;

      if (isMobile) {
        navigate(path, { escape: true });
        return;
      }

      navigate(path);
    },
    [isMobile, navigate],
  );
};
