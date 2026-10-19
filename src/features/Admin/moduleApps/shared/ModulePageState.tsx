'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { AlertTriangle, FilterX, Inbox, RefreshCw, SearchX } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  `,
  description: css`
    max-width: 440px;
    margin: 0;

    font-size: 14px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  detailBody: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(240px, 3fr);
    gap: 16px;
    min-height: 260px;

    @media (width < 640px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  detailHeader: css`
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 16px;
    align-items: center;

    min-height: 80px;
  `,
  icon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  line: css`
    height: 14px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorFillSecondary};
  `,
  list: css`
    display: grid;
    gap: 8px;
    min-height: 320px;
  `,
  listRow: css`
    display: grid;
    grid-template-columns: minmax(140px, 2fr) minmax(80px, 1fr) 96px;
    gap: 16px;
    align-items: center;

    box-sizing: border-box;
    min-height: 48px;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  panel: css`
    display: grid;
    gap: 12px;
    align-content: start;

    min-height: 260px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  skeleton: css`
    width: 100%;
    padding: 16px;
  `,
  skeletonStack: css`
    display: grid;
    gap: 10px;
  `,
  state: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    box-sizing: border-box;
    min-height: 280px;
    padding-block: 32px;
    padding-inline: 20px;
  `,
  title: css`
    margin: 0;

    font-size: 18px;
    font-weight: 600;
    line-height: 26px;
    color: ${cssVar.colorText};
    text-align: center;
  `,
}));

export type ModulePageStateAction = {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
};

export interface ModulePageStateProps {
  children: ReactNode;
  emptyDescription?: ReactNode;
  emptyKind?: 'filtered' | 'initial';
  emptyTitle?: ReactNode;
  error?: unknown;
  errorDescription?: ReactNode;
  errorTitle?: ReactNode;
  isEmpty: boolean;
  loading?: boolean;
  loadingLabel?: string;
  onClearFilters?: () => void;
  onRetry?: () => void;
  primaryAction?: ModulePageStateAction | ReactNode;
  retryLabel?: ReactNode;
  skeletonVariant?: 'detail' | 'list';
}

const isActionConfig = (
  action: ModulePageStateProps['primaryAction'],
): action is ModulePageStateAction =>
  Boolean(
    action &&
    !isValidElement(action) &&
    typeof action === 'object' &&
    'label' in action &&
    'onClick' in action,
  );

const ModuleListSkeleton = ({ label }: { label: string }) => (
  <section
    aria-busy="true"
    aria-label={label}
    className={styles.skeleton}
    data-testid="module-list-skeleton"
  >
    <div className={styles.list}>
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.listRow} key={index}>
          <div className={styles.line} />
          <div className={styles.line} />
          <div className={styles.line} />
        </div>
      ))}
    </div>
  </section>
);

const ModuleDetailSkeleton = ({ label }: { label: string }) => (
  <section
    aria-busy="true"
    aria-label={label}
    className={styles.skeleton}
    data-testid="module-detail-skeleton"
  >
    <div className={styles.detailHeader}>
      <div className={styles.panel} style={{ minHeight: 64, padding: 0 }} />
      <div className={styles.skeletonStack}>
        <div className={styles.line} style={{ maxWidth: 260 }} />
        <div className={styles.line} style={{ maxWidth: 420 }} />
      </div>
    </div>
    <div className={styles.detailBody}>
      <div className={styles.panel} />
      <div className={styles.panel} />
    </div>
  </section>
);

export const ModulePageState = ({
  children,
  emptyDescription,
  emptyKind = 'initial',
  emptyTitle,
  error,
  errorDescription,
  errorTitle,
  isEmpty,
  loading,
  loadingLabel,
  onClearFilters,
  onRetry,
  primaryAction,
  retryLabel,
  skeletonVariant = 'list',
}: ModulePageStateProps) => {
  const { t } = useTranslation('common');
  const translate = (key: string) => t(key as any);
  const resolvedLoadingLabel = loadingLabel ?? translate('moduleApps.admin.center.state.loading');

  if (loading) {
    return skeletonVariant === 'detail' ? (
      <ModuleDetailSkeleton label={resolvedLoadingLabel} />
    ) : (
      <ModuleListSkeleton label={resolvedLoadingLabel} />
    );
  }

  if (error) {
    return (
      <section className={styles.state} data-testid="module-error-state">
        <AlertTriangle aria-hidden className={styles.icon} size={32} />
        <h2 className={styles.title}>
          {errorTitle ?? translate('moduleApps.admin.center.state.loadErrorTitle')}
        </h2>
        <p className={styles.description}>
          {errorDescription ?? translate('moduleApps.admin.center.state.loadErrorDescription')}
        </p>
        {onRetry ? (
          <Button htmlType="button" onClick={onRetry}>
            <RefreshCw aria-hidden size={16} />
            {retryLabel ?? translate('moduleApps.admin.center.state.retry')}
          </Button>
        ) : null}
      </section>
    );
  }

  if (isEmpty) {
    const filtered = emptyKind === 'filtered';

    return (
      <section className={styles.state} data-testid={`module-empty-${emptyKind}`}>
        {filtered ? (
          <SearchX aria-hidden className={styles.icon} size={32} />
        ) : (
          <Inbox aria-hidden className={styles.icon} size={32} />
        )}
        <h2 className={styles.title}>
          {emptyTitle ??
            translate(
              filtered
                ? 'moduleApps.admin.center.state.emptyFilteredTitle'
                : 'moduleApps.admin.center.state.emptyInitialTitle',
            )}
        </h2>
        <p className={styles.description}>
          {emptyDescription ??
            translate(
              filtered
                ? 'moduleApps.admin.center.state.emptyFilteredDescription'
                : 'moduleApps.admin.center.state.emptyInitialDescription',
            )}
        </p>
        {primaryAction || (filtered && onClearFilters) ? (
          <div className={styles.actions}>
            {isActionConfig(primaryAction) ? (
              <Button
                disabled={primaryAction.disabled}
                htmlType="button"
                type="primary"
                onClick={primaryAction.onClick}
              >
                {primaryAction.icon}
                {primaryAction.label}
              </Button>
            ) : (
              primaryAction
            )}
            {filtered && onClearFilters ? (
              <Button htmlType="button" onClick={onClearFilters}>
                <FilterX aria-hidden size={16} />
                {translate('moduleApps.admin.center.state.clearFilters')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return children;
};

export default ModulePageState;
