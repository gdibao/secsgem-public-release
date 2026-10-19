'use client';

import { type ReactNode } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import MobileContentFrame from './components/MobileContentFrame';

const MobilePageLayout = ({ children, header }: { children?: ReactNode; header?: ReactNode }) => (
  <MobileContentLayout header={header}>
    <MobileContentFrame>{children ?? <Outlet />}</MobileContentFrame>
  </MobileContentLayout>
);

export default MobilePageLayout;
