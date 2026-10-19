'use client';

import { Icon } from '@lobehub/ui';
import { confirmModal, Tabs } from '@lobehub/ui/base-ui';
import { Laptop } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useLocation, useSearchParams } from 'react-router';

import {
  ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
  ADMIN_SETTINGS_SECTION_SWR_KEY,
} from '@/const/adminCacheKeys';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import { AdminPageShell } from '../layout';
import BrandPage from './BrandPage';
import BuildProfilePage from './BuildProfilePage';
import DistributionPage from './DistributionPage';
import OverviewPage from './OverviewPage';
import { desktopControlCenterStyles } from './styles';
import { resolveDesktopControlCenterTab } from './types';
import UpdateSettingsPage from './UpdateSettingsPage';

const DesktopControlCenter = memo(() => {
  const { t } = useTranslation('subscription');
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const setDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);
  const blocker = useBlocker(() => dirtyRef.current && !allowNavigationRef.current);
  const activeKey = resolveDesktopControlCenterTab(searchParams.get('tab'));
  const settings = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('desktop-update'), () =>
    adminCommercialService.getSettingsSection('desktop-update'),
  );
  const overview = useClientDataSWR(ADMIN_DESKTOP_OVERVIEW_SWR_KEY, () =>
    adminCommercialService.getDesktopOverview(),
  );

  const confirmDiscard = useCallback(
    (onConfirm: () => void, onCancel?: () => void) =>
      confirmModal({
        cancelText: t('admin.desktopControl.unsaved.cancel'),
        content: t('admin.desktopControl.unsaved.description'),
        okText: t('admin.desktopControl.unsaved.discard'),
        onCancel,
        onOk: onConfirm,
        title: t('admin.desktopControl.unsaved.title'),
      }),
    [t],
  );

  const commitTabChange = (tab: string) => {
    allowNavigationRef.current = true;
    setDirty(false);
    const nextSearchParams = new URLSearchParams(searchParams);
    if (tab === 'overview') nextSearchParams.delete('tab');
    else nextSearchParams.set('tab', tab);
    setSearchParams(nextSearchParams);
  };

  const changeTab = (tab: string) => {
    if (tab === activeKey) return;
    if (dirtyRef.current) {
      confirmDiscard(() => commitTabChange(tab));
      return;
    }
    commitTabChange(tab);
  };

  useEffect(() => {
    allowNavigationRef.current = false;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirmDiscard(
      () => {
        allowNavigationRef.current = true;
        setDirty(false);
        blocker.proceed();
      },
      () => blocker.reset(),
    );
  }, [blocker, confirmDiscard, setDirty]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  return (
    <AdminPageShell
      width="full"
      description={t(
        'admin.desktopControl.subtitle',
        '统一管理桌面端品牌、安装包、更新策略和分发状态。',
      )}
      title={
        <span>
          <Icon icon={Laptop} size={20} /> {t('admin.desktopControl.title')}
        </span>
      }
    >
      <Tabs
        activeKey={activeKey}
        className={desktopControlCenterStyles.tabs}
        items={[
          {
            children: (
              <OverviewPage resource={overview} onConfigure={() => void changeTab('updates')} />
            ),
            key: 'overview',
            label: t('admin.desktopControl.tabs.overview'),
          },
          {
            children: (
              <DistributionPage overview={overview} settings={settings} onDirtyChange={setDirty} />
            ),
            key: 'distribution',
            label: t('admin.desktopControl.tabs.distribution'),
          },
          {
            children: <UpdateSettingsPage settings={settings} onDirtyChange={setDirty} />,
            key: 'updates',
            label: t('admin.desktopControl.tabs.updates'),
          },
          {
            children: <BrandPage settings={settings} onDirtyChange={setDirty} />,
            key: 'brand',
            label: t('admin.desktopControl.tabs.brand'),
          },
          {
            children: (
              <BuildProfilePage
                currentRelease={
                  settings.data?.desktopUpdateConfig?.currentVersion
                    ? {
                        channel:
                          settings.data.desktopUpdateConfig.channel === 'canary'
                            ? 'canary'
                            : 'stable',
                        version: settings.data.desktopUpdateConfig.currentVersion,
                      }
                    : undefined
                }
                onDirtyChange={setDirty}
                onReleaseActivated={() => Promise.all([settings.mutate(), overview.mutate()])}
              />
            ),
            key: 'build-profile',
            label: t('admin.desktopControl.tabs.buildProfile'),
          },
        ]}
        onChange={(tab) => void changeTab(tab)}
      />
    </AdminPageShell>
  );
});

DesktopControlCenter.displayName = 'DesktopControlCenter';

export default DesktopControlCenter;
