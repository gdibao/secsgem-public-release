'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import RunningTasksCard from '@/features/HomeInbox/RunningTasksCard';
import UnreadTopicList from '@/features/HomeInbox/UnreadTopicList';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import { MobileListSkeleton, MobileSection, MobileStateView } from '../components';

const MobilePendingInbox = memo(() => {
  const { t } = useTranslation('common');
  const isLogin = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);
  const topics = useHomeInboxTopics(isLogin);
  const unread = useMemo(
    () => topics.unread.filter((topic) => !userId || topic.userId === userId),
    [topics.unread, userId],
  );
  const running = useMemo(
    () => topics.running.filter((topic) => !userId || topic.userId === userId),
    [topics.running, userId],
  );
  const refreshAction = {
    label: t('mobile.recent.refreshPending'),
    onClick: topics.reload,
  };

  if (!topics.isInit && !topics.error) {
    return (
      <MobileSection title={t('mobile.recent.pending')}>
        <Flexbox aria-busy="true" role="status">
          <MobileListSkeleton label={t('mobile.recent.pending')} rows={4} />
        </Flexbox>
      </MobileSection>
    );
  }

  if (topics.error) {
    return (
      <MobileSection title={t('mobile.recent.pending')}>
        <MobileStateView
          action={refreshAction}
          title={t('mobile.recent.pendingError')}
          variant="error"
        />
      </MobileSection>
    );
  }

  if (unread.length === 0 && running.length === 0) {
    return (
      <MobileSection title={t('mobile.recent.pending')}>
        <MobileStateView action={refreshAction} title={t('mobile.recent.pendingEmpty')} />
      </MobileSection>
    );
  }

  return (
    <Flexbox gap={16}>
      {unread.length > 0 ? (
        <MobileSection
          action={refreshAction}
          title={t('mobile.recent.pendingUnread', { count: unread.length })}
        >
          <UnreadTopicList topics={unread} onFollowUpSent={topics.promoteToRunning} />
        </MobileSection>
      ) : null}
      {running.length > 0 ? (
        <MobileSection title={t('mobile.recent.pendingRunning', { count: running.length })}>
          <RunningTasksCard running={running} />
        </MobileSection>
      ) : null}
    </Flexbox>
  );
});

MobilePendingInbox.displayName = 'MobilePendingInbox';

export default MobilePendingInbox;
