'use client';

import { Icon, Skeleton } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Boxes, CircleAlert, KeyRound, RefreshCw, Store } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { moduleAppService } from '@/services/moduleApp';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import {
  MobileIconGrid,
  MobileSection,
  MobileStateView,
  MobileWorkspaceHeader,
} from '../components';
import { mobileNavigateOptions } from '../destinationRegistry';
import { getMobileIcon } from '../mobileIcons';
import MobilePageLayout from '../MobilePageLayout';
import { useMobileSlotState } from '../mobileSlotState';
import { useMobileConfig } from '../useMobileConfig';
import {
  buildMobileBuiltinApps,
  buildMobileModuleApps,
  type MobileInstalledModuleApp,
} from './builtinApps';

const APP_GRID_MIN_CELL_SIZE = 64;
const APP_LOADING_CELL_COUNT = 4;

const styles = createStaticStyles(({ css, cssVar }) => ({
  appCell: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: flex-start;

    min-width: 0;
    min-height: 104px;
    padding-block: 8px;
    padding-inline: 0;
    border: 0;

    color: ${cssVar.colorText};

    background: transparent;

    &:active {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  appCellDisabled: css`
    cursor: not-allowed;
    color: ${cssVar.colorTextDisabled};

    &:active {
      background: transparent;
    }
  `,
  appGrid: css`
    grid-auto-rows: 104px;
  `,
  appIcon: css`
    position: relative;

    display: grid;
    flex: 0 0 44px;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 8px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorFillSecondary};
  `,
  readinessError: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  readinessIndicator: css`
    position: absolute;
    inset-block-start: -5px;
    inset-inline-end: -5px;

    display: grid;
    place-items: center;

    width: 18px;
    height: 18px;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};
  `,
  appLabel: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    max-width: 100%;
    min-height: 36px;

    font-size: 13px;
    line-height: 18px;
    text-align: center;
  `,
  appLogo: css`
    display: block;
    width: 28px;
    height: 28px;
    object-fit: contain;
  `,
  compactState: css`
    [data-testid='mobile-state-view'] {
      min-height: 132px;
      padding-block: 16px;
    }
  `,
  marketAction: css`
    min-width: 44px;
    min-height: 44px;
  `,
  page: css`
    width: 100%;
    padding-block: 12px 20px;
  `,
  section: css`
    padding-block: 4px 12px;
  `,
  skeletonCell: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;

    min-height: 104px;
    padding-block: 8px;
    padding-inline: 0;
  `,
  skeletonLabel: css`
    width: 100%;
    padding-inline: 4px;
  `,
  skeletonLabelBar: css`
    display: block;

    width: 72%;
    height: 14px;
    margin-inline: auto;
    border-radius: 4px;

    background: ${cssVar.colorFillTertiary};
  `,
  skeletonStatus: css`
    width: 100%;
  `,
}));

const MobileAppGridSkeleton = ({ label }: { label: string }) => (
  <div
    aria-busy="true"
    aria-label={label}
    className={styles.skeletonStatus}
    data-testid="mobile-apps-loading"
    role="status"
  >
    <MobileIconGrid className={styles.appGrid} minCellSize={APP_GRID_MIN_CELL_SIZE}>
      {Array.from({ length: APP_LOADING_CELL_COUNT }, (_, index) => (
        <div className={styles.skeletonCell} key={index}>
          <Skeleton.Avatar active shape="square" size={44} />
          <div className={styles.skeletonLabel}>
            <span className={styles.skeletonLabelBar} data-testid="apps-loading-label" />
          </div>
        </div>
      ))}
    </MobileIconGrid>
  </div>
);

const MobileModuleAppIcon = ({ icon, name }: { icon?: null | string; name: string }) => {
  const [imageFailed, setImageFailed] = useState(false);

  if (!icon || imageFailed) {
    return (
      <span data-testid="mobile-module-app-fallback-icon">
        <Icon icon={Boxes} size={22} />
      </span>
    );
  }

  return (
    <img alt={name} className={styles.appLogo} src={icon} onError={() => setImageFailed(true)} />
  );
};

const MobileAppsPage = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { config } = useMobileConfig();
  const { data, error, isLoading, isValidating, mutate } = useSWR<MobileInstalledModuleApp[]>(
    ['mobile-module-apps', activeWorkspaceId],
    () => moduleAppService.listAvailableApps(activeWorkspaceId ?? undefined),
    { revalidateOnFocus: true, revalidateOnReconnect: true, shouldRetryOnError: false },
  );
  const { rememberFocus } = useMobileSlotState({
    scopeId: activeWorkspaceId ?? 'personal',
    slotId: 'slot-4',
  });

  const builtins = useMemo(
    () => buildMobileBuiltinApps(config.applications.builtins),
    [config.applications.builtins],
  );
  const moduleApps = useMemo(
    () => buildMobileModuleApps(data ?? [], config.applications.featuredModuleAppIds),
    [config.applications.featuredModuleAppIds, data],
  );
  const pageTitle =
    config.navigation.items.find((item) => item.id === 'slot-4')?.label || t('mobile.apps.title');
  const openMarket = () => navigate('/apps/market');
  const isModuleAppsLoading = !error && (isLoading || data === undefined);
  const hasResolvedEmptyModuleApps =
    !isLoading && !error && data !== undefined && moduleApps.length === 0;

  return (
    <MobilePageLayout
      header={
        <MobileWorkspaceHeader
          style={mobileHeaderSticky}
          title={pageTitle}
          actions={[
            {
              disabled: isValidating,
              icon: RefreshCw,
              label: t('mobile.refresh'),
              onClick: () => void mutate(),
            },
          ]}
          right={
            !hasResolvedEmptyModuleApps ? (
              <Button
                aria-label={t('mobile.apps.browseMarket')}
                className={styles.marketAction}
                htmlType="button"
                icon={<Icon icon={Store} size={18} />}
                type="primary"
                onClick={openMarket}
              >
                {t('mobile.apps.browseMarket')}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <main className={styles.page}>
        <MobileSection className={styles.section} title={t('mobile.apps.builtIn')}>
          <MobileIconGrid className={styles.appGrid} minCellSize={APP_GRID_MIN_CELL_SIZE}>
            {builtins.map((app) => {
              const AppIcon = getMobileIcon(app.icon);
              return (
                <button
                  aria-label={t('mobile.apps.open', { name: app.label })}
                  className={styles.appCell}
                  data-mobile-focus-key={`builtin:${app.id}`}
                  key={app.id}
                  type="button"
                  onClick={() => {
                    rememberFocus(`builtin:${app.id}`);
                    const options = mobileNavigateOptions(app.path);
                    options ? navigate(app.path, options) : navigate(app.path);
                  }}
                >
                  <span className={styles.appIcon}>
                    <Icon icon={AppIcon} size={22} />
                  </span>
                  <span className={styles.appLabel}>{app.label}</span>
                </button>
              );
            })}
          </MobileIconGrid>
        </MobileSection>

        <MobileSection className={styles.section} title={t('mobile.apps.module')}>
          {isModuleAppsLoading ? (
            <MobileAppGridSkeleton label={t('mobile.apps.loading')} />
          ) : error ? (
            <MobileStateView
              action={{ label: t('mobile.apps.retry'), onClick: () => void mutate() }}
              title={t('mobile.apps.error')}
              variant="error"
            />
          ) : moduleApps.length ? (
            <MobileIconGrid className={styles.appGrid} minCellSize={APP_GRID_MIN_CELL_SIZE}>
              {moduleApps.map((app) => {
                const runtimeUnavailable = app.installationReadiness?.runtime === 'unavailable';
                const configurationNeedsAttention =
                  app.installationReadiness?.configuration === 'invalid' ||
                  app.installationReadiness?.configuration === 'required';
                const readinessLabel = runtimeUnavailable
                  ? t('moduleApps.readiness.runtimeUnavailable')
                  : app.installationReadiness?.configuration === 'invalid'
                    ? t('moduleApps.readiness.configurationInvalid')
                    : t('moduleApps.readiness.configurationRequired');
                const ReadinessIcon = runtimeUnavailable ? CircleAlert : KeyRound;

                return (
                  <button
                    data-mobile-focus-key={`module:${app.id}`}
                    data-readiness={runtimeUnavailable ? 'unavailable' : 'ready'}
                    data-testid="mobile-module-app"
                    disabled={runtimeUnavailable}
                    key={app.id}
                    type="button"
                    aria-label={t(
                      runtimeUnavailable ? 'mobile.apps.unavailable' : 'mobile.apps.open',
                      { name: app.displayName },
                    )}
                    className={`${styles.appCell} ${
                      runtimeUnavailable ? styles.appCellDisabled : ''
                    }`}
                    onClick={() => {
                      rememberFocus(`module:${app.id}`);
                      return app.installationScope === 'personal'
                        ? navigate(app.routePath, { escape: true })
                        : navigate(app.routePath);
                    }}
                  >
                    <span className={styles.appIcon}>
                      <MobileModuleAppIcon icon={app.icon} name={app.displayName} />
                      {runtimeUnavailable || configurationNeedsAttention ? (
                        <span
                          title={readinessLabel}
                          className={`${styles.readinessIndicator} ${
                            runtimeUnavailable ||
                            app.installationReadiness?.configuration === 'invalid'
                              ? styles.readinessError
                              : ''
                          }`}
                        >
                          <Icon aria-hidden icon={ReadinessIcon} size={10} />
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.appLabel}>{app.displayName}</span>
                  </button>
                );
              })}
            </MobileIconGrid>
          ) : (
            <div className={styles.compactState}>
              <MobileStateView
                action={{ label: t('mobile.apps.browseMarket'), onClick: openMarket }}
                title={t('mobile.apps.empty')}
                variant="empty"
              />
            </div>
          )}
        </MobileSection>
      </main>
    </MobilePageLayout>
  );
});

MobileAppsPage.displayName = 'MobileAppsPage';

export default MobileAppsPage;
