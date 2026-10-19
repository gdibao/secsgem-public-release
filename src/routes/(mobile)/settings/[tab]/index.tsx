'use client';

import { useParams } from 'react-router';

import SettingsContent from '@/features/Settings/features/SettingsContent';

const MobileSettingsTab = () => {
  const { tab } = useParams<{ tab?: string }>();

  return <SettingsContent mobile activeTab={tab} />;
};

export default MobileSettingsTab;
