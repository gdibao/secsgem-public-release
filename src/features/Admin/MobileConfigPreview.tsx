'use client';

import { Icon, Segmented } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Boxes } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';
import { type MobilePublicConfigV1,normalizeMobileConfig } from '@/const/mobileConfig';
import { getMobileIcon } from '@/features/MobileWorkspace/mobileIcons';

const styles = createStaticStyles(({ css, cssVar }) => ({
  appCell: css`
    display: grid;
    gap: 8px;
    place-items: center;

    min-width: 0;
    min-height: 104px;
    padding-block: 8px;
    padding-inline: 0;

    font-size: 13px;
    line-height: 18px;
    text-align: center;
  `,
  appIcon: css`
    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 8px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorFillSecondary};
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
  designCell: css`
    display: grid;
    gap: 6px;
    place-items: center;

    min-width: 0;
    min-height: 88px;
    padding-block: 8px;
    padding-inline: 4px;

    font-size: 13px;
    line-height: 18px;
    text-align: center;
  `,
  designLabel: css`
    overflow: hidden;

    max-width: 100%;

    font-size: 13px;
    line-height: 18px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  assistantAvatar: css`
    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 8px;

    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  assistantMeta: css`
    overflow: hidden;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  assistantName: css`
    overflow: hidden;

    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  assistantRow: css`
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) minmax(72px, auto);
    gap: 12px;
    align-items: center;

    min-height: 76px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  assistantText: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  `,
  brand: css`
    overflow: hidden;

    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  brandLogo: css`
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: contain;
  `,
  content: css`
    overflow: auto;
    flex: 1;
    padding: 12px;
    background: ${cssVar.colorBgLayout};
  `,
  frame: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    min-width: 280px;
    max-width: 360px;
    min-height: 560px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  `,
  appGrid: css`
    grid-auto-rows: 104px;
  `,
  header: css`
    display: flex;
    flex: 0 0 ${MOBILE_TABBAR_HEIGHT}px;
    gap: 8px;
    align-items: center;

    min-height: ${MOBILE_TABBAR_HEIGHT}px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  nav: css`
    display: grid;
    flex: 0 0 ${MOBILE_TABBAR_HEIGHT}px;
    min-height: ${MOBILE_TABBAR_HEIGHT}px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  navIcon: css`
    display: grid;
    place-items: center;
    height: 22px;
  `,
  navItem: css`
    display: grid;
    grid-template-rows: 22px 16px;
    gap: 2px;
    place-items: center;

    min-width: 0;
    height: ${MOBILE_TABBAR_HEIGHT}px;
    min-height: 44px;
    padding-block: 4px;
    padding-inline: 2px;
    border: 0;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    &:not(:disabled) {
      cursor: pointer;
    }
  `,
  navItemActive: css`
    color: ${cssVar.colorPrimary};

    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 24%, transparent);
    }
  `,
  preview: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    max-width: 360px;
  `,
  recentAvatar: css`
    display: grid;
    place-items: center;

    width: 40px;
    height: 40px;
    border-radius: 8px;

    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  recentMeta: css`
    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  recentRow: css`
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    align-items: center;

    min-height: 64px;
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  recentText: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  `,
  recentTitle: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-block-end: 16px;
  `,
  sectionHeader: css`
    display: flex;
    align-items: center;
    min-height: 44px;
  `,
  sectionTitle: css`
    margin: 0;

    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
}));

type MobilePreviewMode = 'recent' | 'design' | 'discover' | 'apps';

type MobileConfigPreviewProps = {
  config: MobilePublicConfigV1;
};

const previewModeSlot: Record<
  MobilePreviewMode,
  MobilePublicConfigV1['navigation']['items'][number]['id']
> = {
  apps: 'slot-4',
  design: 'slot-2',
  discover: 'slot-3',
  recent: 'slot-1',
};

const previewSlotMode: Record<
  MobilePublicConfigV1['navigation']['items'][number]['id'],
  MobilePreviewMode
> = {
  'slot-1': 'recent',
  'slot-2': 'design',
  'slot-3': 'discover',
  'slot-4': 'apps',
};

const previewRecentRows = [
  {
    labelKey: 'admin.mobile.preview.recent.sample',
    titleKey: 'admin.mobile.preview.recent.sampleTitleOne',
  },
  {
    labelKey: 'admin.mobile.preview.recent.sample',
    titleKey: 'admin.mobile.preview.recent.sampleTitleTwo',
  },
] as const;

const MobileConfigPreview = memo<MobileConfigPreviewProps>(({ config }) => {
  const { t } = useTranslation('subscription');
  const normalizedConfig = useMemo(() => normalizeMobileConfig(config), [config]);
  const [mode, setMode] = useState<MobilePreviewMode>('recent');
  const visibleTabs = useMemo(
    () =>
      normalizedConfig.navigation.items
        .filter((item) => item.visible)
        .sort((left, right) => left.order - right.order),
    [normalizedConfig.navigation.items],
  );
  const enabledTools = useMemo(
    () =>
      normalizedConfig.design.tools
        .filter((tool) => tool.enabled)
        .sort((left, right) => left.order - right.order),
    [normalizedConfig.design.tools],
  );
  const enabledBuiltins = useMemo(
    () =>
      normalizedConfig.applications.builtins
        .filter((app) => app.enabled)
        .sort((left, right) => left.order - right.order),
    [normalizedConfig.applications.builtins],
  );
  const assistants = useMemo(
    () => [...normalizedConfig.discover.assistants].sort((left, right) => left.order - right.order),
    [normalizedConfig.discover.assistants],
  );
  const brandName = normalizedConfig.brand.displayName || 'ComHub';
  const modeOptions = useMemo(
    () => [
      { label: t('admin.mobile.preview.recent'), value: 'recent' },
      { label: t('admin.mobile.preview.design'), value: 'design' },
      { label: t('admin.mobile.preview.discover'), value: 'discover' },
      { label: t('admin.mobile.preview.apps'), value: 'apps' },
    ],
    [t],
  );

  const section = (title: string, children: ReactNode, testId?: string) => (
    <section className={styles.section} data-testid={testId}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
      </div>
      {children}
    </section>
  );

  const previewBody = () => {
    switch (mode) {
      case 'design': {
        return section(
          t('admin.mobile.designTools'),
          <div className={styles.grid} data-testid="mobile-preview-design-tools">
            {enabledTools.map((tool) => {
              const ToolIcon = getMobileIcon(tool.icon);
              return (
                <div
                  className={styles.designCell}
                  data-preview-cell-height="88"
                  data-preview-cell-kind="design"
                  data-preview-label-lines="1"
                  data-testid="mobile-preview-grid-item"
                  key={tool.id}
                >
                  <span className={styles.appIcon}>
                    <Icon icon={ToolIcon} size={22} />
                  </span>
                  <span className={styles.designLabel}>{tool.label}</span>
                </div>
              );
            })}
          </div>,
        );
      }

      case 'discover': {
        return (
          <>
            {section(
              normalizedConfig.discover.title || t('admin.mobile.featuredAssistants'),
              <div data-testid="mobile-preview-discover-list">
                {assistants.map((assistant) => {
                  const title = assistant.titleOverride || assistant.assistantId;
                  return (
                    <div
                      className={styles.assistantRow}
                      data-testid="mobile-preview-assistant-row"
                      key={assistant.assistantId}
                    >
                      <span className={styles.assistantAvatar}>
                        {title.slice(0, 1).toUpperCase()}
                      </span>
                      <span className={styles.assistantText}>
                        <span className={styles.assistantName}>{title}</span>
                        {assistant.descriptionOverride ? (
                          <span className={styles.assistantMeta}>
                            {assistant.descriptionOverride}
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.assistantMeta}>
                        {assistant.modelLabelOverride || '推荐'}
                      </span>
                    </div>
                  );
                })}
              </div>,
            )}
            {normalizedConfig.discover.community.enabled
              ? section(
                  normalizedConfig.discover.community.title,
                  <div className={styles.recentText} data-testid="mobile-preview-community">
                    <span className={styles.recentTitle}>Recommended assistants</span>
                    <span className={styles.recentMeta}>Community tools and creators</span>
                  </div>,
                )
              : null}
          </>
        );
      }

      case 'apps': {
        return (
          <>
            {section(
              t('admin.mobile.preview.builtinApps'),
              <div className={`${styles.grid} ${styles.appGrid}`}>
                {enabledBuiltins.map((app) => {
                  const AppIcon = getMobileIcon(app.icon);
                  return (
                    <div
                      className={styles.appCell}
                      data-preview-cell-height="104"
                      data-preview-cell-kind="app"
                      data-preview-label-lines="2"
                      data-testid="mobile-preview-grid-item"
                      key={app.id}
                    >
                      <span className={styles.appIcon}>
                        <Icon icon={AppIcon} size={22} />
                      </span>
                      <span className={styles.appLabel}>{app.label}</span>
                    </div>
                  );
                })}
              </div>,
              'mobile-preview-apps-builtins',
            )}
            {section(
              t('admin.mobile.preview.moduleApps'),
              <div className={`${styles.grid} ${styles.appGrid}`}>
                {normalizedConfig.applications.featuredModuleAppIds.map((id) => (
                  <div
                    className={styles.appCell}
                    data-preview-cell-height="104"
                    data-preview-cell-kind="app"
                    data-preview-label-lines="2"
                    data-testid="mobile-preview-grid-item"
                    key={id}
                  >
                    <span className={styles.appIcon}>
                      <Icon icon={Boxes} size={22} />
                    </span>
                    <span className={styles.appLabel}>{id}</span>
                  </div>
                ))}
              </div>,
              'mobile-preview-apps-modules',
            )}
          </>
        );
      }

      default: {
        return section(
          t('admin.mobile.preview.recentTitle'),
          <div>
            {previewRecentRows.map((row) => {
              const title = t(row.titleKey);
              return (
                <div
                  className={styles.recentRow}
                  data-testid="mobile-preview-recent-row"
                  key={row.titleKey}
                >
                  <span className={styles.recentAvatar}>{title.slice(0, 1)}</span>
                  <span className={styles.recentText}>
                    <span className={styles.recentTitle}>{title}</span>
                    <span className={styles.recentMeta}>{t(row.labelKey)}</span>
                  </span>
                </div>
              );
            })}
          </div>,
        );
      }
    }
  };

  return (
    <div className={styles.preview}>
      <Segmented
        aria-label={t('admin.mobile.previewMode')}
        options={modeOptions}
        value={mode}
        onChange={(value) => setMode(value as MobilePreviewMode)}
      />
      <div className={styles.frame} data-testid="mobile-config-preview">
        <header className={styles.header}>
          {normalizedConfig.brand.logoUrl ? (
            <img
              alt={brandName}
              className={styles.brandLogo}
              src={normalizedConfig.brand.logoUrl}
            />
          ) : null}
          <span className={styles.brand}>{brandName}</span>
        </header>

        <div className={styles.content}>{previewBody()}</div>

        <nav
          className={styles.nav}
          style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
          aria-label={t('admin.mobile.bottomNavigation', {
            defaultValue: 'Bottom Navigation',
          })}
        >
          {visibleTabs.map((item) => {
            const TabIcon = getMobileIcon(item.icon);
            const active = item.id === previewModeSlot[mode];
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                data-testid={`mobile-preview-nav-${item.id}`}
                key={item.id}
                type="button"
                onClick={() => setMode(previewSlotMode[item.id])}
              >
                <span className={styles.navIcon}>
                  <Icon icon={TabIcon} size={20} />
                </span>
                <span className={styles.label}>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
});

MobileConfigPreview.displayName = 'MobileConfigPreview';

export default MobileConfigPreview;
