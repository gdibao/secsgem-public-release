import type { ModuleAppInstallationReadiness } from '@lobechat/types';
import { A } from '@lobehub/ui';
import { Button, buttonStyles } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    box-sizing: border-box;
    min-width: 0;
    min-height: 180px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    margin: 0;

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  footer: css`
    display: grid;
    gap: 8px;
    margin-block-start: auto;
    padding-block-start: 2px;
  `,
  footerInstalled: css`
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 96px), 1fr));
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  `,
  installed: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
  readinessError: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  readinessWarning: css`
    color: ${cssVar.colorWarning};
    background: ${cssVar.colorWarningBg};
  `,
  statuses: css`
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
  `,
  metadata: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;

    min-width: 0;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  title: css`
    min-width: 0;
    margin: 0;

    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  updateAvailable: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};
  `,
}));

type ModuleAppCardProps = {
  category?: string;
  description?: string;
  id: string;
  installed?: boolean;
  installationReadiness?: ModuleAppInstallationReadiness;
  name: string;
  publishedVersion?: string;
  updateAvailable?: boolean;
  version?: string;
  workspaceId?: string;
};

const ModuleAppCard = memo<ModuleAppCardProps>(
  ({
    category,
    description,
    id,
    installed,
    installationReadiness,
    name,
    publishedVersion,
    updateAvailable,
    version,
    workspaceId,
  }) => {
    const { t } = useTranslation('common');
    const titleId = useId();
    const detailUrl = `/apps/${id}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`;
    const openUrl = `/apps/${id}/app${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`;
    const runtimeUnavailable = installationReadiness?.runtime === 'unavailable';

    return (
      <article aria-labelledby={titleId} className={styles.card}>
        <header className={styles.header}>
          <h3 className={styles.title} id={titleId}>
            {name}
          </h3>
          {installed ? (
            <div className={styles.statuses}>
              <span className={styles.installed}>{t('moduleApps.market.installed')}</span>
              {updateAvailable ? (
                <span className={styles.updateAvailable}>
                  {t('moduleApps.market.updateAvailable')}
                </span>
              ) : null}
              {installationReadiness?.configuration === 'required' ? (
                <span className={cx(styles.installed, styles.readinessWarning)}>
                  {t('moduleApps.readiness.configurationRequired')}
                </span>
              ) : null}
              {installationReadiness?.configuration === 'invalid' ? (
                <span className={cx(styles.installed, styles.readinessError)}>
                  {t('moduleApps.readiness.configurationInvalid')}
                </span>
              ) : null}
              {runtimeUnavailable ? (
                <span className={cx(styles.installed, styles.readinessError)}>
                  {t('moduleApps.readiness.runtimeUnavailable')}
                </span>
              ) : null}
            </div>
          ) : null}
        </header>
        {category || version || (updateAvailable && publishedVersion) ? (
          <div className={styles.metadata}>
            {category ? <span>{category}</span> : null}
            {version ? (
              <span>
                {t('moduleApps.market.version')} {version}
              </span>
            ) : null}
            {updateAvailable && publishedVersion ? (
              <span>
                {t('moduleApps.market.latestVersion')} {publishedVersion}
              </span>
            ) : null}
          </div>
        ) : null}
        {description ? <p className={styles.description}>{description}</p> : null}
        <div className={cx(styles.footer, installed && styles.footerInstalled)}>
          {installed ? (
            runtimeUnavailable ? (
              <Button
                block
                disabled
                aria-label={t('moduleApps.market.openFor', { name })}
                type="primary"
              >
                {t('moduleApps.market.open')}
              </Button>
            ) : (
              <A
                aria-label={t('moduleApps.market.openFor', { name })}
                href={openUrl}
                className={cx(
                  buttonStyles.base,
                  buttonStyles.sizeMiddle,
                  buttonStyles.variantPrimary,
                  buttonStyles.block,
                )}
              >
                {t('moduleApps.market.open')}
              </A>
            )
          ) : null}
          <A
            aria-label={t('moduleApps.market.viewDetailsFor', { name })}
            href={detailUrl}
            className={cx(
              buttonStyles.base,
              buttonStyles.sizeMiddle,
              buttonStyles.variantDefault,
              buttonStyles.block,
            )}
          >
            {t('moduleApps.market.viewDetails')}
          </A>
        </div>
      </article>
    );
  },
);

ModuleAppCard.displayName = 'ModuleAppCard';

export default ModuleAppCard;
