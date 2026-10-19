'use client';

import NavHeader from '@/features/NavHeader';

import PptWorkspace from './features/PptWorkspace';

const PptPage = () => (
  <>
    <NavHeader />
    <PptWorkspace />
  </>
);

export const MobilePptPage = () => <PptWorkspace />;

export default PptPage;
