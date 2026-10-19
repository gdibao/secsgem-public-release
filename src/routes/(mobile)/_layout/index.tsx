'use client';

import { type FC } from 'react';
import { Suspense } from 'react';
import { Outlet } from 'react-router';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import Loading from '@/components/Loading/BrandTextLoading';
import { MobileWorkspaceShell } from '@/features/MobileWorkspace';
import { RouteMetaBridge } from '@/features/RouteMeta';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));

const MobileMainLayout: FC = () => {
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  return (
    <WorkspaceContextSlot>
      <RouteMetaBridge />
      <Suspense fallback={null}>{showCloudPromotion && <CloudBanner mobile />}</Suspense>
      <Suspense fallback={<Loading debugId="MobileMainLayout > Outlet" />}>
        <MobileWorkspaceShell>
          <Outlet />
        </MobileWorkspaceShell>
      </Suspense>
    </WorkspaceContextSlot>
  );
};

export default MobileMainLayout;
