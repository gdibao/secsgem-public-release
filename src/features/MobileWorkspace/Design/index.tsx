'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileDesignService } from '@/services/mobileDesign';
import { usePageStore } from '@/store/page';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import {
  MobileIconGrid,
  MobileListSkeleton,
  MobileSection,
  MobileStateView,
  MobileWorkspaceHeader,
} from '../components';
import { getMobileIcon } from '../mobileIcons';
import MobilePageLayout from '../MobilePageLayout';
import { useMobileSlotState } from '../mobileSlotState';
import { useMobileConfig } from '../useMobileConfig';
import { buildMobileDesignTools, type MobileDesignTool } from './designItems';

const MOBILE_ACTION_STYLE = { minHeight: 44, minWidth: 44 };

const styles = createStaticStyles(({ css, cssVar }) => ({
  createError: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    margin-block: 4px 12px;
    padding: 8px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: 8px;

    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  createErrorText: css`
    min-width: 0;
    font-size: 13px;
    line-height: 20px;
  `,
  itemDate: css`
    align-self: center;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  itemIcon: css`
    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 8px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorFillTertiary};
  `,
  itemMeta: css`
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
  `,
  itemMetaPart: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemStatus: css`
    &::before {
      content: '/';
      margin-inline-end: 6px;
    }
  `,
  itemText: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    min-width: 0;

    text-align: start;
  `,
  itemTitle: css`
    overflow: hidden;

    font-size: 15px;
    font-weight: 500;
    line-height: 22px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  page: css`
    width: 100%;
    padding-block: 12px 20px;
  `,
  recentButton: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;

    width: 100%;
    min-height: 68px;
    padding-block: 10px;
    border: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    color: inherit;
    text-align: start;

    background: transparent;

    &:active {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  section: css`
    padding-block: 4px 12px;
  `,
  toolButton: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    justify-content: center;

    min-width: 0;
    min-height: 88px;
    padding-block: 8px;
    padding-inline: 4px;
    border: 0;
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: transparent;

    &:active {
      background: ${cssVar.colorFillQuaternary};
    }

    &:disabled {
      cursor: wait;
      opacity: 0.6;
    }
  `,
  toolIcon: css`
    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 8px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorFillSecondary};
  `,
  toolLabel: css`
    overflow: hidden;

    max-width: 100%;

    font-size: 13px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const formatUpdatedAt = (value: Date) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(value));

const MobileDesignPage = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const createNewPage = usePageStore((state) => state.createNewPage);
  const { config } = useMobileConfig();
  const [creatingTool, setCreatingTool] = useState<MobileDesignTool['id']>();
  const [createError, setCreateError] = useState<string>();
  const [failedTool, setFailedTool] = useState<MobileDesignTool>();
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ['mobile-design-recent', activeWorkspaceId, 20],
    () => mobileDesignService.getRecent(20),
    { revalidateOnFocus: true, revalidateOnReconnect: true, shouldRetryOnError: false },
  );
  const { rememberFocus } = useMobileSlotState({
    scopeId: activeWorkspaceId ?? 'personal',
    slotId: 'slot-2',
  });

  const tools = useMemo(() => buildMobileDesignTools(config.design.tools), [config.design.tools]);
  const documentTool = tools.find((tool) => tool.id === 'document');
  const designSlot = config.navigation.items.find((item) => item.id === 'slot-2');
  const pageTitle = designSlot?.path === '/design' ? designSlot.label : '设计';

  const handleCreate = async (tool: MobileDesignTool) => {
    setCreateError(undefined);
    setFailedTool(undefined);

    if (tool.id !== 'document') {
      navigate(tool.routePath);
      return;
    }

    setCreatingTool(tool.id);
    try {
      const id = await createNewPage(t('mobile.design.untitled'), {
        suppressFailureNavigation: true,
      });
      navigate(`/page/${encodeURIComponent(id)}`);
    } catch {
      setCreateError(t('mobile.design.createError'));
      setFailedTool(tool);
    } finally {
      setCreatingTool(undefined);
    }
  };

  const createAction = documentTool
    ? {
        disabled: Boolean(creatingTool),
        label: t('mobile.design.createDocument'),
        loading: creatingTool === documentTool.id,
        onClick: () => void handleCreate(documentTool),
      }
    : undefined;

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
        />
      }
    >
      <main className={styles.page}>
        <MobileSection className={styles.section} title={t('mobile.design.create')}>
          <MobileIconGrid minCellSize={88}>
            {tools.map((tool) => {
              const ToolIcon = getMobileIcon(tool.icon);
              return (
                <button
                  aria-label={t('mobile.design.createTool', { name: tool.label })}
                  className={styles.toolButton}
                  data-mobile-focus-key={`tool:${tool.id}`}
                  data-testid="mobile-design-tool"
                  disabled={Boolean(creatingTool)}
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    rememberFocus(`tool:${tool.id}`);
                    void handleCreate(tool);
                  }}
                >
                  <span className={styles.toolIcon}>
                    <Icon icon={ToolIcon} size={22} />
                  </span>
                  <span className={styles.toolLabel}>{tool.label}</span>
                </button>
              );
            })}
          </MobileIconGrid>
        </MobileSection>

        {createError && failedTool ? (
          <div className={styles.createError} role="alert">
            <span className={styles.createErrorText}>{createError}</span>
            <Button
              htmlType="button"
              size="large"
              style={MOBILE_ACTION_STYLE}
              type="default"
              onClick={() => void handleCreate(failedTool)}
            >
              {t('mobile.design.retryCreate', { name: failedTool.label })}
            </Button>
          </div>
        ) : null}

        <MobileSection className={styles.section} title={t('mobile.design.recent')}>
          {isLoading ? (
            <MobileListSkeleton label={t('mobile.design.recent')} rows={4} />
          ) : error ? (
            <MobileStateView
              action={{ label: t('mobile.design.retry'), onClick: () => void mutate() }}
              title={t('mobile.design.error')}
              variant="error"
            />
          ) : data?.length ? (
            <div>
              {data.map((item) => {
                const startsNewPresentation = item.kind === 'ppt' && item.resumeSupported === false;
                const status = startsNewPresentation
                  ? t('mobile.design.startNewPresentation')
                  : item.status;
                const ItemIcon = getMobileIcon(
                  item.kind === 'document'
                    ? 'file-text'
                    : item.kind === 'image'
                      ? 'image'
                      : 'presentation',
                );
                return (
                  <button
                    className={styles.recentButton}
                    data-mobile-focus-key={`${item.kind}:${item.id}`}
                    data-testid="mobile-design-recent-row"
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    aria-label={
                      startsNewPresentation
                        ? t('mobile.design.startNewPresentation')
                        : t('mobile.design.open', { name: item.title })
                    }
                    onClick={() => {
                      rememberFocus(`${item.kind}:${item.id}`);
                      navigate(item.routePath);
                    }}
                  >
                    <span className={styles.itemIcon}>
                      <Icon icon={ItemIcon} size={20} />
                    </span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle} data-testid="mobile-design-recent-title">
                        {item.title}
                      </span>
                      <span className={styles.itemMeta}>
                        <span className={styles.itemMetaPart} data-testid="mobile-design-recent-kind">
                          {t(`mobile.design.kind.${item.kind}`)}
                        </span>
                        {status ? (
                          <span
                            className={`${styles.itemMetaPart} ${styles.itemStatus}`}
                            data-testid="mobile-design-recent-status"
                          >
                            {status}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <time
                      className={styles.itemDate}
                      data-testid="mobile-design-recent-date"
                      dateTime={new Date(item.updatedAt).toISOString()}
                    >
                      {formatUpdatedAt(item.updatedAt)}
                    </time>
                  </button>
                );
              })}
            </div>
          ) : (
            <MobileStateView action={createAction} title={t('mobile.design.empty')} variant="empty" />
          )}
        </MobileSection>
      </main>
    </MobilePageLayout>
  );
});

MobileDesignPage.displayName = 'MobileDesignPage';

export default MobileDesignPage;
