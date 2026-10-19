'use client';

import { Avatar } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';
import { mobileHeaderSticky } from '@/styles/mobileHeader';
import { AssistantSorts, McpSorts } from '@/types/discover';

import {
  MobileListSkeleton,
  MobileSection,
  MobileStateView,
  MobileWorkspaceHeader,
} from '../components';
import MobilePageLayout from '../MobilePageLayout';
import { useMobileSlotState } from '../mobileSlotState';
import { useMobileConfig } from '../useMobileConfig';
import { buildFeaturedAssistantCards } from './featuredAssistants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    flex: 0 0 auto;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 13px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
  `,
  community: css`
    display: grid;
    gap: 12px;
  `,
  communityColumn: css`
    display: grid;
    gap: 4px;
  `,
  communityColumnTitle: css`
    margin: 0;

    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
  communityRow: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 64px;
    padding: 8px 0;
    border: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    color: inherit;
    text-align: start;

    background: transparent;

    &:active {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  communityMeta: css`
    overflow: hidden;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  communityName: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  communityText: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  `,
  list: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);

    @media (width >= 640px) and (orientation: landscape) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 16px;
    }
  `,
  model: css`
    overflow: hidden;

    width: 88px;
    max-width: 88px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  page: css`
    width: 100%;
    padding-block: 12px 20px;
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 88px;
    gap: 12px;
    align-items: center;

    width: 100%;
    min-height: 76px;
    padding-block: 8px;
    padding-inline: 0;
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
  text: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  `,
  title: css`
    overflow: hidden;

    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const MobileDiscoverPage = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const useAssistantList = useDiscoverStore((state) => state.useAssistantList);
  const useMcpList = useDiscoverStore((state) => state.useFetchMcpList);
  const { config, error, isLoading, isValidating, mutate } = useMobileConfig();
  const { rememberFocus } = useMobileSlotState({ scopeId: 'global', slotId: 'slot-3' });
  const communityEnabled = config.discover.community.enabled;
  const cards = useMemo(
    () => buildFeaturedAssistantCards(config.discover.featuredAssistants ?? []),
    [config.discover.featuredAssistants],
  );
  const {
    data: communityAssistants,
    error: communityAssistantError,
    isLoading: communityAssistantLoading,
    mutate: mutateCommunityAssistants,
  } = useAssistantList({
    page: 1,
    pageSize: 4,
    sort: AssistantSorts.Recommended,
  }, { enabled: communityEnabled });
  const {
    data: communityMcps,
    error: communityMcpError,
    isLoading: communityMcpLoading,
    mutate: mutateCommunityMcps,
  } = useMcpList({
    page: 1,
    pageSize: 4,
    sort: McpSorts.Recommended,
  }, { enabled: communityEnabled });
  const communityAssistantItems = communityAssistants?.items ?? [];
  const communityMcpItems = communityMcps?.items ?? [];
  const communityLoading = communityAssistantLoading || communityMcpLoading;
  const communityError = communityAssistantError || communityMcpError;
  const communityHasItems = communityAssistantItems.length > 0 || communityMcpItems.length > 0;
  const pageTitle =
    config.navigation.items.find((item) => item.id === 'slot-3')?.label || t('tab.discover');
  const communityTitle =
    config.discover.community.title ||
    t('mobile.discover.community', { defaultValue: 'Community' });
  const refreshCommunity = () =>
    void Promise.all([mutateCommunityAssistants(), mutateCommunityMcps()]);

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
        <MobileSection className={styles.section} title={config.discover.title}>
          {isLoading ? (
            <MobileListSkeleton
              avatarSize={44}
              className={styles.list}
              label={config.discover.title}
              minRowHeight={76}
              rows={4}
              trailingWidth={88}
            />
          ) : error ? (
            <MobileStateView
              action={{ label: t('mobile.discover.retry'), onClick: () => void mutate() }}
              title={t('mobile.discover.error')}
              variant="error"
            />
          ) : cards.length === 0 ? (
            <MobileStateView
              description={t('mobile.discover.emptyDescription')}
              title={t('mobile.discover.empty')}
              actions={[
                {
                  label: t('mobile.discover.browseCommunity'),
                  onClick: () => navigate('/community', { escape: true }),
                },
              ]}
            />
          ) : (
            <div
              aria-label={config.discover.title}
              className={styles.list}
              data-testid="featured-assistant-list"
            >
              {cards.map((card) => (
                <button
                  aria-label={t('mobile.discover.open', { name: card.title })}
                  className={styles.row}
                  data-mobile-focus-key={`assistant:${card.identifier}`}
                  data-testid="featured-assistant-row"
                  key={card.identifier}
                  type="button"
                  onClick={() => {
                    rememberFocus(`assistant:${card.identifier}`);
                    navigate(card.routePath, { escape: true });
                  }}
                >
                  <Avatar
                    avatar={card.avatar}
                    className={styles.avatar}
                    shape="square"
                    size={44}
                    title={card.title}
                  />
                  <span className={styles.text}>
                    <span className={styles.title} data-testid="featured-assistant-title">
                      {card.title}
                    </span>
                    <span
                      className={styles.description}
                      data-clamp-lines="2"
                      data-testid="featured-assistant-description"
                    >
                      {card.description}
                    </span>
                  </span>
                  <span
                    className={styles.model}
                    data-testid="featured-assistant-model"
                    title={card.model.displayName}
                  >
                    {card.model.displayName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </MobileSection>
        {communityEnabled ? (
          <MobileSection
            className={styles.section}
            title={communityTitle}
            action={{
              disabled: communityLoading,
              icon: RefreshCw,
              label: t('mobile.refresh'),
              onClick: refreshCommunity,
            }}
          >
            {communityLoading ? (
              <MobileListSkeleton
                avatarSize={40}
                label={communityTitle}
                minRowHeight={64}
                rows={4}
              />
            ) : communityError ? (
              <MobileStateView
                action={{ label: t('mobile.discover.retry'), onClick: refreshCommunity }}
                variant="error"
                title={t('mobile.discover.communityError', {
                  defaultValue: 'Unable to load community recommendations',
                })}
              />
            ) : !communityHasItems ? (
              <MobileStateView
                title={t('mobile.discover.communityEmpty', { defaultValue: 'Community is empty' })}
                description={t('mobile.discover.communityEmptyDescription', {
                  defaultValue: 'Recommended assistants and tools will appear here.',
                })}
              />
            ) : (
              <div className={styles.community} data-testid="mobile-community-sections">
                {communityAssistantItems.length > 0 ? (
                  <div className={styles.communityColumn} data-testid="mobile-community-assistants">
                    <h3 className={styles.communityColumnTitle}>
                      {t('mobile.discover.communityAssistants', {
                        defaultValue: 'Recommended assistants',
                      })}
                    </h3>
                    {communityAssistantItems.map((assistant) => {
                      const title = assistant.title || assistant.identifier;
                      const route = `/community/${assistant.type === 'agent-group' ? 'group_agent' : 'agent'}/${encodeURIComponent(assistant.identifier)}`;
                      return (
                        <button
                          aria-label={t('mobile.discover.open', { name: title })}
                          className={styles.communityRow}
                          key={assistant.identifier}
                          type="button"
                          onClick={() => navigate(route, { escape: true })}
                        >
                          <Avatar
                            avatar={assistant.avatar}
                            shape="square"
                            size={40}
                            title={title}
                          />
                          <span className={styles.communityText}>
                            <span className={styles.communityName}>{title}</span>
                            <span className={styles.communityMeta}>
                              {assistant.description || assistant.author || assistant.identifier}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {communityMcpItems.length > 0 ? (
                  <div className={styles.communityColumn} data-testid="mobile-community-tools">
                    <h3 className={styles.communityColumnTitle}>
                      {t('mobile.discover.communityTools', { defaultValue: 'Recommended tools' })}
                    </h3>
                    {communityMcpItems.map((mcp) => (
                      <button
                        aria-label={t('mobile.discover.open', { name: mcp.name })}
                        className={styles.communityRow}
                        key={mcp.identifier}
                        type="button"
                        onClick={() =>
                          navigate(`/community/mcp/${encodeURIComponent(mcp.identifier)}`, {
                            escape: true,
                          })
                        }
                      >
                        <Avatar avatar={mcp.icon} shape="square" size={40} title={mcp.name} />
                        <span className={styles.communityText}>
                          <span className={styles.communityName}>{mcp.name}</span>
                          <span className={styles.communityMeta}>
                            {mcp.description || mcp.author || mcp.identifier}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </MobileSection>
        ) : null}
      </main>
    </MobilePageLayout>
  );
});

MobileDiscoverPage.displayName = 'MobileDiscoverPage';

export default MobileDiscoverPage;
