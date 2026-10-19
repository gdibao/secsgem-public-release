'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import useSWR from 'swr';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { ENGINEERING_TOOL_DESTINATIONS, resolveEngineeringToolMenu } from '@/const/engineeringToolDestination';
import {
  MOBILE_TABBAR_HEIGHT,
  MOBILE_WORKSPACE_CONTENT_MAX_WIDTH,
} from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { lambdaClient } from '@/libs/trpc/client';

import { mobileNavigateOptions } from './destinationRegistry';
import { getMobileIcon } from './mobileIcons';
import { resolveMobileActiveSlot, shouldShowMobileTabBar } from './navigation';
import { useMobileConfig } from './useMobileConfig';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 24%, transparent);
    }
  `,
  container: css`
    position: fixed;
    z-index: 100;
    inset-block-end: 0;
    inset-inline: 0;

    display: grid;

    padding-block-end: env(safe-area-inset-bottom);
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  icon: css`
    display: grid;
    place-items: center;
    height: 22px;
  `,
  inner: css`
    display: grid;
    width: 100%;
    max-width: ${MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}px;
    margin-inline: auto;
  `,
  item: css`
    cursor: pointer;

    display: grid;
    grid-template-rows: 22px 16px;
    gap: 2px;
    place-items: center;

    min-width: 0;
    height: ${MOBILE_TABBAR_HEIGHT}px;
    padding-block: 4px;
    padding-inline: 2px;
    border: none;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  itemActive: css`
    color: ${cssVar.colorPrimary};
  `,
  label: css`
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const MobileTabBar = memo(() => {
  const { t } = useTranslation('common');
  const { config } = useMobileConfig();
  const { pathname } = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const navigate = useWorkspaceAwareNavigate();
  const { data: engineeringMenu, error: engineeringMenuError, isLoading: engineeringMenuLoading } = useSWR(
    'engineering-tools-menu',
    () => lambdaClient.engineeringTools.menu.query(),
    { revalidateOnFocus: true },
  );
  const engineeringEntry = resolveEngineeringToolMenu(engineeringMenu).find((item) => item.enabled);
  const items = useMemo(
    () =>
      config.navigation.items
        .filter((item) => item.visible && (item.id !== 'slot-2' ||
          item.path !== ENGINEERING_TOOL_DESTINATIONS.catalog ||
          (engineeringMenu === null || (engineeringMenu === undefined && !engineeringMenuLoading && !engineeringMenuError)) ||
          Boolean(engineeringEntry)))
        .sort((left, right) => left.order - right.order)
        .map((item) => {
          const MobileIcon = getMobileIcon(item.icon);
          const sharedEntry = item.id === 'slot-2' && item.path === ENGINEERING_TOOL_DESTINATIONS.catalog
            ? engineeringEntry : undefined;
          return {
            icon: MobileIcon,
            key: item.id,
            path: sharedEntry?.path ?? item.path,
            title: sharedEntry?.label ?? item.label,
          };
        }),
    [config.navigation.items, engineeringEntry, engineeringMenu, engineeringMenuError, engineeringMenuLoading],
  );

  if (!shouldShowMobileTabBar(pathname, config, activeWorkspaceSlug)) return null;
  const activeSlot = resolveMobileActiveSlot(pathname, config, activeWorkspaceSlug);

  return (
    <footer
      aria-label={t('mobile.navigation.ariaLabel')}
      className={styles.container}
      data-active-key={activeSlot}
      role="navigation"
    >
      <div
        className={styles.inner}
        data-mobile-content-max-width={MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}
        data-testid="mobile-tab-bar-inner"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = item.key === activeSlot;
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={`${styles.item} ${active ? styles.itemActive : ''}`}
              key={item.key}
              type="button"
              onClick={() => {
                const options = mobileNavigateOptions(item.path);
                options ? navigate(item.path, options) : navigate(item.path);
              }}
            >
              <span className={styles.icon}>
                <Icon className={active ? styles.active : undefined} icon={item.icon} size={20} />
              </span>
              <span className={styles.label}>{item.title}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
});

MobileTabBar.displayName = 'MobileTabBar';

export default MobileTabBar;
