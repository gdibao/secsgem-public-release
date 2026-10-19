'use client';

import { isAdminRole } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { FloatingSheet } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, Home, Menu, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, useLocation } from 'react-router';

import { AdminSidebar } from '@/features/Admin';
import {
  canAccessAdminPath,
  getAdminNavigationContext,
  getAdminUnauthorizedFallbackPath,
} from '@/features/Admin/adminNavigation';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  breadcrumbCurrent: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
  `,
  breadcrumbLink: css`
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusXS};
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  content: css`
    scrollbar-gutter: stable;

    overflow: auto;

    min-width: 0;
    min-height: 0;

    background: ${cssVar.colorBgLayout};
  `,
  contentColumn: css`
    display: grid;
    grid-template-rows: 52px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;

    @media (width < 768px) {
      grid-template-rows: 48px minmax(0, 1fr);
    }
  `,
  contextBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    min-width: 0;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    @media (width < 768px) {
      padding-inline: 10px 12px;
    }
  `,
  contextPrimary: css`
    overflow: hidden;
    display: flex;
    gap: 10px;
    align-items: center;

    min-width: 0;
  `,
  homeLink: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    min-height: 32px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  layout: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: 264px minmax(0, 1fr);
    flex: 1;

    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;

    @media (width < 992px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  loading: css`
    box-sizing: border-box;
    width: 100%;
    padding: 24px;
  `,
  mobileTitle: css`
    overflow: hidden;

    min-width: 0;

    font-size: ${cssVar.fontSize};
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sheetContent: css`
    overflow: hidden;
    height: 100%;
    min-height: 0;
  `,
  sidebar: css`
    overflow: hidden;

    min-width: 0;
    min-height: 0;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

const narrowViewportQuery = '(max-width: 991px)';

export const shouldUseAdminNavigationSheet = (matchesNarrowViewport: boolean) =>
  matchesNarrowViewport;

const AdminLayout = () => {
  const location = useLocation();
  const { t } = useTranslation('subscription');
  const [matchesNarrowViewport, setMatchesNarrowViewport] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(narrowViewportQuery);
    const update = () => setMatchesNarrowViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const useNavigationSheet = shouldUseAdminNavigationSheet(matchesNarrowViewport);
  const mobile = matchesNarrowViewport;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [user, isUserStateInit] = useUserStore((s) => [
    userProfileSelectors.userProfile(s),
    s.isUserStateInit,
  ]);
  const role = (user as any)?.role as string | undefined;
  const context = useMemo(
    () => getAdminNavigationContext(role, location.pathname),
    [location.pathname, role],
  );

  if (!isUserStateInit) {
    return (
      <Flexbox className={styles.loading} data-testid="admin-layout-loading" gap={16}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Flexbox>
    );
  }
  if (!isAdminRole(role)) return <Navigate replace to="/" />;
  if (!canAccessAdminPath(role, location.pathname)) {
    return <Navigate replace to={getAdminUnauthorizedFallbackPath(role, location.pathname)} />;
  }

  const currentTitle = context
    ? t(`admin.navigation.items.${context.item.id}.label`, {
        defaultValue: context.item.label,
      })
    : t('admin.navigation.title', '管理后台');
  const currentGroupTitle = context
    ? t(`admin.navigation.groups.${context.group.key}.label`, {
        defaultValue: context.group.label,
      })
    : '';

  return (
    <div className={styles.layout} data-testid="admin-layout-shell">
      {!useNavigationSheet ? (
        <aside aria-label={t('admin.navigation.title', '管理后台')} className={styles.sidebar}>
          <AdminSidebar />
        </aside>
      ) : null}
      <div className={styles.contentColumn}>
        <header className={styles.contextBar} data-testid="admin-context-bar">
          <div className={styles.contextPrimary}>
            {useNavigationSheet ? (
              <ActionIcon
                aria-label={t('admin.navigation.open', '打开管理导航')}
                icon={Menu}
                title={t('admin.navigation.open', '打开管理导航')}
                onClick={() => setNavigationOpen(true)}
              />
            ) : null}
            {mobile ? (
              <strong className={styles.mobileTitle}>{currentTitle}</strong>
            ) : (
              <nav
                aria-label={t('admin.navigation.breadcrumb', '当前位置')}
                className={styles.breadcrumb}
              >
                <Link className={styles.breadcrumbLink} to="/settings/admin">
                  {t('admin.navigation.title', '管理后台')}
                </Link>
                <Icon aria-hidden icon={ChevronRight} size={14} />
                <span>{currentGroupTitle}</span>
                <Icon aria-hidden icon={ChevronRight} size={14} />
                <strong className={styles.breadcrumbCurrent}>{currentTitle}</strong>
              </nav>
            )}
          </div>
          <Link
            aria-label={t('admin.navigation.backToApp', '返回前台')}
            className={styles.homeLink}
            to="/"
          >
            <Icon aria-hidden icon={Home} size={16} />
            {!mobile ? t('admin.navigation.backToApp', '返回前台') : null}
          </Link>
        </header>
        <div className={styles.content} data-testid="admin-layout-content">
          <Outlet />
        </div>
      </div>
      {useNavigationSheet ? (
        <FloatingSheet
          dismissible
          maxHeight={720}
          minHeight={360}
          mode="overlay"
          open={navigationOpen}
          restingHeight={680}
          snapPoints={[520, 680]}
          title={t('admin.navigation.title', '管理后台')}
          variant="elevated"
          headerActions={
            <ActionIcon
              aria-label={t('admin.navigation.close', '关闭管理导航')}
              icon={X}
              title={t('admin.navigation.close', '关闭管理导航')}
              onClick={() => setNavigationOpen(false)}
            />
          }
          onOpenChange={setNavigationOpen}
        >
          <div className={styles.sheetContent}>
            <AdminSidebar onNavigate={() => setNavigationOpen(false)} />
          </div>
        </FloatingSheet>
      ) : null}
    </div>
  );
};

AdminLayout.displayName = 'AdminLayout';

export default AdminLayout;
