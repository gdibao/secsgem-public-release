'use client';

import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';

import Header from './Header';

const MobileSettingsWrapper = () => {
  const location = useLocation();

  useEffect(() => {
    const container = document.getElementById('lobe-mobile-scroll-container');
    container?.scrollTo?.({ behavior: 'auto', top: 0 });
  }, [location.pathname, location.search]);

  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <MobileContentLayout header={<Header />}>
        <Outlet />
      </MobileContentLayout>
    </SettingsContextProvider>
  );
};

export default MobileSettingsWrapper;
