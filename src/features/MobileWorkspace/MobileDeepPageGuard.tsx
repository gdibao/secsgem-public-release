'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeft } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const styles = createStaticStyles(({ css, cssVar }) => ({
  back: css`
    cursor: pointer;

    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;

    color: ${cssVar.colorText};

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  content: css`
    overflow: hidden auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    position: relative;
    z-index: 2;

    flex: 0 0 44px;

    box-sizing: border-box;
    height: 44px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
}));

const MobileDeepPageGuard = memo(() => {
  const { t } = useTranslation('common');
  const location = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const navigate = useWorkspaceAwareNavigate();
  const workspacePrefix = activeWorkspaceSlug ? `/${activeWorkspaceSlug}` : undefined;
  const isWorkspaceRoute = Boolean(
    workspacePrefix &&
      (location.pathname === workspacePrefix || location.pathname.startsWith(`${workspacePrefix}/`)),
  );
  const scopedPath = isWorkspaceRoute ? location.pathname.slice(workspacePrefix!.length) || '/' : location.pathname;
  const fallbackPath = scopedPath.startsWith('/apps') ? '/apps' : '/design';
  const goBack = () => {
    if (location.key === 'default') {
      isWorkspaceRoute ? navigate(fallbackPath) : navigate(fallbackPath, { escape: true });
      return;
    }
    navigate(-1);
  };

  useEffect(() => {
    document.getElementById('mobile-deep-page-content')?.scrollTo?.({ behavior: 'auto', top: 0 });
  }, [location.pathname, location.search]);

  return (
    <div className={styles.root} data-testid="mobile-deep-page-guard">
      <header className={styles.header} data-testid="mobile-deep-page-header">
        <button
          aria-label={t('back')}
          className={styles.back}
          title={t('back')}
          type="button"
          onClick={goBack}
        >
          <Icon icon={ChevronLeft} size={22} />
        </button>
      </header>
      <div className={styles.content} data-testid="mobile-deep-page-content">
        <Outlet />
      </div>
    </div>
  );
});

MobileDeepPageGuard.displayName = 'MobileDeepPageGuard';

export default MobileDeepPageGuard;
