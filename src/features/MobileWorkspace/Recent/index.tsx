'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { Button, Segmented, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import {
  type ChangeEvent,
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { recentService } from '@/services/recent';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import {
  MobileContentFrame,
  MobileListSkeleton,
  MobileSection,
  MobileStateView,
} from '../components';
import { useMobileSlotState } from '../mobileSlotState';
import { useCreateAssistant } from '../useCreateAssistant';
import MobilePendingInbox from './MobilePendingInbox';
import RecentConversationRow from './RecentConversationRow';
import { filterMobileRecentItems, type MobileRecentConversation } from './recentItems';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;
const MOBILE_LOAD_MORE_BUTTON_STYLE = { minHeight: 44, minWidth: 44 } satisfies CSSProperties;

const styles = createStaticStyles(({ css }) => ({
  page: css`
    width: 100%;
    padding-block: 8px 16px;
  `,
  sections: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  search: css`
    padding-block: 4px 8px;
  `,
  switcher: css`
    padding-block: 4px;
  `,
}));

const MobileRecentPage = memo(() => {
  const { t } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const isLogin = useUserStore(authSelectors.isLogin);
  const navigate = useWorkspaceAwareNavigate();
  const pinAgent = useHomeStore((state) => state.pinAgent);
  const pinAgentGroup = useHomeStore((state) => state.pinAgentGroup);
  const {
    query: searchQuery,
    rememberFocus,
    setQuery: setSearchQuery,
  } = useMobileSlotState({ scopeId: activeWorkspaceId ?? 'personal', slotId: 'slot-1' });
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [mode, setMode] = useState<'pending' | 'recent'>('recent');
  const pinningKeysRef = useRef(new Set<string>());
  const [pinningKeys, setPinningKeys] = useState<Set<string>>(() => new Set());
  const togglePinRef = useRef<(item: MobileRecentConversation) => void>(() => undefined);
  const { createAssistant, creating } = useCreateAssistant();
  const getKey = useCallback(
    (
      pageIndex: number,
      previousPageData: Awaited<ReturnType<typeof recentService.getMobileWorkspace>> | null,
    ) => {
      if (isLogin === false || (previousPageData && !previousPageData.nextCursor)) return null;
      return [
        'mobile-recent-workspace',
        activeWorkspaceId,
        searchQuery,
        pageIndex === 0 ? undefined : previousPageData?.nextCursor,
      ] as const;
    },
    [activeWorkspaceId, isLogin, searchQuery],
  );
  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, , query, cursor]) =>
      recentService.getMobileWorkspace({ cursor, limit: PAGE_SIZE, query: query || undefined }),
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (searchInput === searchQuery) return;
    const timeout = window.setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput, searchQuery, setSearchQuery]);

  const conversations = useMemo(() => data?.flatMap((page) => page.items) ?? [], [data]);
  const sections = useMemo(
    () =>
      filterMobileRecentItems(
        {
          pinned: conversations.filter((item) => item.pinned),
          recent: conversations.filter((item) => !item.pinned),
        },
        searchInput,
      ),
    [conversations, searchInput],
  );
  const hasItems = sections.pinned.length > 0 || sections.recent.length > 0;
  const hasMore = Boolean(data?.at(-1)?.nextCursor);

  const togglePin = useCallback(
    async (item: MobileRecentConversation) => {
      const key = `${item.kind}:${item.id}`;
      if (pinningKeysRef.current.has(key)) return;

      pinningKeysRef.current.add(key);
      setPinningKeys(new Set(pinningKeysRef.current));
      try {
        if (item.kind === 'group') {
          await pinAgentGroup(item.sessionId, !item.pinned);
        } else {
          await pinAgent(item.sessionId, !item.pinned);
        }
        await mutate();
      } catch {
        toast.error({
          actions: [
            { label: t('mobile.recent.retryPin'), onClick: () => void togglePinRef.current(item) },
          ],
          title: t('mobile.recent.pinError'),
        });
      } finally {
        pinningKeysRef.current.delete(key);
        setPinningKeys(new Set(pinningKeysRef.current));
      }
    },
    [mutate, pinAgent, pinAgentGroup, t],
  );
  togglePinRef.current = (item) => void togglePin(item);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
  }, [setSearchQuery]);

  const refreshAction = {
    icon: RefreshCw,
    label: t('mobile.recent.refresh'),
    loading: isValidating,
    onClick: () => void refresh(),
  };

  return (
    <main className={styles.page}>
      <MobileContentFrame>
        <div className={styles.switcher}>
          <Segmented
            block
            value={mode}
            options={[
              { label: t('mobile.recent.modeRecent'), value: 'recent' },
              { label: t('mobile.recent.modePending'), value: 'pending' },
            ]}
            onChange={(value) => setMode(value as 'pending' | 'recent')}
          />
        </div>
        {mode === 'recent' ? (
          <div className={styles.search}>
            <SearchBar
              allowClear
              aria-label={t('mobile.recent.search')}
              placeholder={t('mobile.recent.search')}
              value={searchInput}
              variant="filled"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setSearchInput(event.target.value)
              }
            />
          </div>
        ) : null}
        <div className={styles.sections}>
          {mode === 'pending' ? (
            <MobilePendingInbox />
          ) : isLoading && isLogin !== false ? (
            <MobileSection action={refreshAction} title={t('mobile.recent.latest')}>
              <Flexbox aria-busy="true" data-testid="mobile-recent-loading" role="status">
                <MobileListSkeleton label={t('mobile.recent.latest')} rows={4} />
              </Flexbox>
            </MobileSection>
          ) : error ? (
            <MobileSection action={refreshAction} title={t('mobile.recent.latest')}>
              <div role="alert">
                <MobileStateView
                  action={{ label: t('retry'), onClick: () => void refresh() }}
                  title={t('mobile.recent.error')}
                  variant="error"
                />
              </div>
            </MobileSection>
          ) : !hasItems ? (
            <MobileSection action={refreshAction} title={t('mobile.recent.latest')}>
              <MobileStateView
                title={searchInput ? t('mobile.recent.emptySearch') : t('mobile.recent.empty')}
                action={
                  searchInput
                    ? { label: t('mobile.recent.clearSearch'), onClick: clearSearch }
                    : {
                        label: t('mobile.recent.createAgent'),
                        loading: creating,
                        onClick: () => void createAssistant(),
                      }
                }
              />
            </MobileSection>
          ) : (
            <>
              {sections.pinned.length > 0 ? (
                <MobileSection
                  action={refreshAction}
                  aria-label={t('mobile.recent.pinned')}
                  title={t('mobile.recent.pinned')}
                >
                  {sections.pinned.map((item) => (
                    <RecentConversationRow
                      item={item}
                      key={item.id}
                      pending={pinningKeys.has(`${item.kind}:${item.id}`)}
                      onTogglePin={() => void togglePin(item)}
                      onOpen={() => {
                        rememberFocus(`${item.kind}:${item.id}`);
                        navigate(item.routePath);
                      }}
                    />
                  ))}
                </MobileSection>
              ) : null}

              {sections.recent.length > 0 ? (
                <MobileSection
                  action={sections.pinned.length ? undefined : refreshAction}
                  aria-label={t('mobile.recent.latest')}
                  title={t('mobile.recent.latest')}
                >
                  {sections.recent.map((item) => (
                    <RecentConversationRow
                      item={item}
                      key={item.id}
                      pending={pinningKeys.has(`${item.kind}:${item.id}`)}
                      onTogglePin={() => void togglePin(item)}
                      onOpen={() => {
                        rememberFocus(`${item.kind}:${item.id}`);
                        navigate(item.routePath);
                      }}
                    />
                  ))}
                </MobileSection>
              ) : null}
              {hasMore ? (
                <Flexbox align="center" padding={16}>
                  <Button
                    aria-label={t('mobile.recent.loadMore')}
                    disabled={isValidating}
                    htmlType="button"
                    loading={isValidating}
                    style={MOBILE_LOAD_MORE_BUTTON_STYLE}
                    onClick={() => void setSize(size + 1)}
                  >
                    {t('mobile.recent.loadMore')}
                  </Button>
                </Flexbox>
              ) : null}
            </>
          )}
        </div>
      </MobileContentFrame>
    </main>
  );
});

MobileRecentPage.displayName = 'MobileRecentPage';

export default MobileRecentPage;
