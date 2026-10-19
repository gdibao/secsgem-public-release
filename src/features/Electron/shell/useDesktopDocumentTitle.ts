'use client';

import { useEffect } from 'react';

import { useBrandName } from '@/features/Brand';
import { useResolvedTabs } from '@/features/Electron/titlebar/TabBar/hooks/useResolvedTabs';

export const useDesktopDocumentTitle = (): void => {
  const { activeTabId, tabs } = useResolvedTabs();
  const brandName = useBrandName();
  const title = tabs.find((tab) => tab.tab.id === activeTabId)?.meta.title;

  useEffect(() => {
    // `useResolvedTabs` falls back to the brand name for untitled routes —
    // suffixing it would render "LobeHub · LobeHub" where web shows the bare name.
    const meaningful = title && title !== brandName;
    document.title = meaningful ? `${title} · ${brandName}` : brandName;
  }, [brandName, title]);
};
