'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet, useLocation } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import SideBar from '@/features/Settings/Layout/SideBar';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

export const isAdminSettingsRoute = (pathname: string) =>
  pathname === '/settings/admin' || pathname.startsWith('/settings/admin/');

const Layout: FC = () => {
  const { pathname } = useLocation();
  const adminWorkspace = isAdminSettingsRoute(pathname);

  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      {adminWorkspace ? null : <SideBar />}
      <Flexbox
        className={styles.mainContainer}
        data-testid={adminWorkspace ? 'admin-settings-workspace' : undefined}
        flex={1}
        height={'100%'}
      >
        <SWRConfig value={{ suspense: true }}>
          <SuspenseRouteBoundary>
            <RouteSkeletonChromeProvider>
              <Outlet />
            </RouteSkeletonChromeProvider>
          </SuspenseRouteBoundary>
        </SWRConfig>
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
