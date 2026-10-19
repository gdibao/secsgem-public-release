'use client';

import SettingsContent from '@/features/Settings/features/SettingsContent';
import { SettingsTabs } from '@/store/global/initialState';

const MeProfilePage = () => {
  return <SettingsContent mobile activeTab={SettingsTabs.Profile} />;
};

export default MeProfilePage;
