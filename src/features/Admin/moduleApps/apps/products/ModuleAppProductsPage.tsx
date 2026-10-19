'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { memo } from 'react';
import { useOutletContext } from 'react-router';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { ModuleAppDetailOutletContext } from '../../layouts/ModuleAppDetailLayout';
import ProductManager from '../../ProductManager';

const ModuleAppProductsPage = memo(() => {
  const { app } = useOutletContext<ModuleAppDetailOutletContext>();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite);

  return <ProductManager appId={app.id} canWrite={canWrite} />;
});

ModuleAppProductsPage.displayName = 'ModuleAppProductsPage';

export default ModuleAppProductsPage;
