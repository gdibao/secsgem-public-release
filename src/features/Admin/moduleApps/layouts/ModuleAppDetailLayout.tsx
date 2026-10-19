'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router';

import ModuleSectionNav from '../navigation/ModuleSectionNav';
import ModulePageState from '../shared/ModulePageState';
import { useModuleAppDetail } from '../shared/useModuleAppDetail';
import type { AdminModuleAppDetail } from '../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  appIdentity: css`
    display: flex;
    gap: 14px;
    align-items: center;
    min-width: 0;
  `,
  content: css`
    min-width: 0;
    padding-block-start: 20px;
  `,
  description: css`
    margin-block: 2px 0;
    margin-inline: 0;

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  frame: css`
    width: 100%;
    min-width: 0;
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    min-height: 88px;
    padding-block: 12px 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    display: grid;
    flex: 0 0 48px;
    place-items: center;

    width: 48px;
    height: 48px;
    border-radius: ${cssVar.borderRadius};

    font-size: 20px;
    font-weight: 600;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  nav: css`
    min-width: 0;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    & > nav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  `,
  status: css`
    flex: 0 0 auto;

    padding-block: 3px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    margin: 0;

    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

export type ModuleAppDetailOutletContext = {
  app: AdminModuleAppDetail;
  refresh: () => Promise<unknown>;
};

const isNotFoundError = (error: unknown) => {
  const candidate = error as
    { data?: { code?: string }; message?: string; status?: number } | undefined;
  return Boolean(
    candidate &&
    (candidate.status === 404 ||
      candidate.data?.code === 'NOT_FOUND' ||
      /NOT_FOUND|not found/i.test(candidate.message ?? '')),
  );
};

const ModuleAppDetailLayout = memo(() => {
  const { appId } = useParams<{ appId: string }>();
  const { t } = useTranslation('common');
  const { app, error, isLoading, refresh } = useModuleAppDetail(appId);
  const notFound = !isLoading && !app && (!error || isNotFoundError(error));

  if (isLoading) {
    return (
      <ModulePageState loading isEmpty={false} skeletonVariant="detail">
        {null}
      </ModulePageState>
    );
  }

  if (notFound) {
    return (
      <ModulePageState
        isEmpty
        emptyDescription={t('moduleApps.admin.center.state.appNotFoundDescription' as any)}
        emptyTitle={t('moduleApps.admin.center.state.appNotFoundTitle' as any)}
      >
        {null}
      </ModulePageState>
    );
  }

  if (error || !app) {
    return (
      <ModulePageState
        error={error ?? new Error('module_app_detail_unavailable')}
        isEmpty={false}
        onRetry={() => void refresh()}
      >
        {null}
      </ModulePageState>
    );
  }

  const context: ModuleAppDetailOutletContext = { app, refresh };

  return (
    <section className={styles.frame}>
      <header className={styles.header} data-testid="module-app-detail-header">
        <div className={styles.appIdentity}>
          <div aria-hidden className={styles.icon}>
            {app.displayName.trim().charAt(0).toUpperCase() || 'M'}
          </div>
          <div>
            <h1 className={styles.title}>{app.displayName}</h1>
            <p className={styles.description}>{app.slug}</p>
          </div>
        </div>
        <span className={styles.status}>{app.status}</span>
      </header>
      <div className={styles.nav}>
        <ModuleSectionNav appId={app.id} mode="detail" />
      </div>
      <div className={styles.content}>
        <Outlet context={context} />
      </div>
    </section>
  );
});

ModuleAppDetailLayout.displayName = 'ModuleAppDetailLayout';

export default ModuleAppDetailLayout;
