'use client';

import { createStaticStyles } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  MOBILE_TABBAR_HEIGHT,
  MOBILE_WORKSPACE_CONTENT_MAX_WIDTH,
} from '@/const/layoutTokens';

import MobileTabBar from './MobileTabBar';
import { shouldShowMobileTabBar } from './navigation';
import { useMobileConfig } from './useMobileConfig';
import { useOnlineStatus } from './useOnlineStatus';

export const MOBILE_WORKSPACE_CLEARANCE_VAR = '--mobile-workspace-bottom-clearance';

const styles = createStaticStyles(({ css, cssVar }) => ({
  offline: css`
    position: fixed;
    z-index: 101;
    inset-inline: 12px;

    box-sizing: border-box;
    width: calc(100% - 24px);
    max-width: ${MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}px;
    min-height: 32px;
    margin-inline: auto;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: 6px;

    font-size: 13px;
    line-height: 18px;
    color: ${cssVar.colorWarningText};
    text-align: center;

    background: ${cssVar.colorWarningBg};
  `,
  shell: css`
    position: relative;

    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding-block-end: var(${MOBILE_WORKSPACE_CLEARANCE_VAR});
  `,
}));

const MobileWorkspaceShell = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { config } = useMobileConfig();
  const isOnline = useOnlineStatus();
  const showTabBar = shouldShowMobileTabBar(pathname, config, activeWorkspaceSlug);
  const clearance = showTabBar
    ? `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom))`
    : '0px';
  const shellStyle = { [MOBILE_WORKSPACE_CLEARANCE_VAR]: clearance } as CSSProperties;

  return (
    <div
      className={styles.shell}
      data-tab-bar-visible={String(showTabBar)}
      data-testid="mobile-workspace-shell"
      style={shellStyle}
    >
      {!isOnline ? (
        <div
          className={styles.offline}
          data-mobile-content-max-width={MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}
          role="status"
          style={{ bottom: `calc(${clearance} + 8px)` }}
        >
          {t('mobile.offline')}
        </div>
      ) : null}
      {children}
      {showTabBar ? <MobileTabBar /> : null}
    </div>
  );
};

export default MobileWorkspaceShell;
