'use client';

import Footer from '@/features/Setting/Footer';
import SettingsContent from '@/features/Settings/features/SettingsContent';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { SettingsTabs } from '@/store/global/initialState';

const Layout = () => {
  const [activeTab] = useQueryState('active', parseAsString.withDefault(SettingsTabs.Profile));

  return (
    <>
      <SettingsContent activeTab={activeTab} mobile={true} />
      <Footer />
    </>
  );
};

export default Layout;
