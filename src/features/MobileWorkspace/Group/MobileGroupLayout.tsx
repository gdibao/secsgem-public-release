'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import GroupIdSync from '@/routes/(main)/group/_layout/GroupIdSync';

import MobileGroupHeader from './MobileGroupHeader';

const MobileGroupLayout: FC = () => {
  useInitGroupConfig();

  return (
    <>
      <MobileContentLayout header={<MobileGroupHeader />}>
        <Outlet />
      </MobileContentLayout>
      <GroupIdSync />
    </>
  );
};

export default MobileGroupLayout;
