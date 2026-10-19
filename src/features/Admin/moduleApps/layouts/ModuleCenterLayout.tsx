'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { FloatingSheet } from '@lobehub/ui/base-ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { Menu, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import ModuleSectionNav from '../navigation/ModuleSectionNav';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    box-sizing: border-box;
    min-width: 0;
    padding: 20px;

    @media (width < 760px) {
      padding: 16px;
    }
  `,
  layout: css`
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);

    width: 100%;
    min-width: 0;
    min-height: 100%;

    @media (width < 1200px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  navigation: css`
    box-sizing: border-box;
    width: 216px;
    min-height: 100%;
    padding: 12px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    @media (width < 1200px) {
      width: 100%;
      min-height: auto;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 0;
    }
  `,
  navigationBar: css`
    min-width: 0;
    min-height: 44px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  sheetContent: css`
    overflow-y: auto;
    height: 100%;
    min-height: 0;
    padding: 8px;
  `,
}));

export const shouldUseModuleNavigationSheet = ({
  mobile,
  xl,
}: {
  mobile?: boolean;
  xl?: boolean;
}) => mobile === true || xl === false;

const ModuleCenterLayout = memo(() => {
  const { t } = useTranslation('common');
  const { mobile = false, xl = true } = useResponsive();
  const useNavigationSheet = shouldUseModuleNavigationSheet({ mobile, xl });
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className={styles.layout}>
      {useNavigationSheet ? (
        <>
          <Flexbox horizontal align="center" className={styles.navigationBar} gap={8}>
            <ActionIcon
              icon={Menu}
              title={t('moduleApps.admin.center.navigation.open')}
              onClick={() => setNavigationOpen(true)}
            />
            <strong>{t('moduleApps.admin.center.navigation.label')}</strong>
          </Flexbox>
          <FloatingSheet
            dismissible
            maxHeight={680}
            minHeight={320}
            mode="overlay"
            open={navigationOpen}
            restingHeight={600}
            snapPoints={[480, 600]}
            title={t('moduleApps.admin.center.navigation.label')}
            variant="elevated"
            headerActions={
              <ActionIcon
                icon={X}
                title={t('moduleApps.admin.center.navigation.close')}
                onClick={() => setNavigationOpen(false)}
              />
            }
            onOpenChange={setNavigationOpen}
          >
            <div className={styles.sheetContent}>
              <ModuleSectionNav onNavigate={() => setNavigationOpen(false)} />
            </div>
          </FloatingSheet>
        </>
      ) : (
        <aside className={styles.navigation}>
          <ModuleSectionNav />
        </aside>
      )}
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
});

ModuleCenterLayout.displayName = 'ModuleCenterLayout';

export default ModuleCenterLayout;
