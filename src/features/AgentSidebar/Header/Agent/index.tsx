'use client';

import type { PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_COMHUB_AGENT_NAME } from '@/const/defaultAgent';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { SidebarHeaderSelectTrigger } from '@/features/NavPanel/SidebarHeaderSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const [isLoading, isInbox, title, avatar, backgroundColor] = useAgentStore((s) => [
    agentSelectors.isAgentConfigLoading(s),
    builtinAgentSelectors.isInboxAgent(s),
    agentSelectors.currentAgentDisplayName(s),
    agentSelectors.currentAgentAvatar(s),
    agentSelectors.currentAgentBackgroundColor(s),
  ]);
  const defaultAgentMeta = useUserStore(settingsSelectors.defaultAgentMeta);

  const displayTitle = isInbox
    ? title || defaultAgentMeta.title || DEFAULT_COMHUB_AGENT_NAME
    : title || t('defaultSession', { ns: 'common' });

  if (isLoading) return <SkeletonItem height={32} padding={0} />;

  return (
    <SwitchPanel>
      <SidebarHeaderSelectTrigger
        background={backgroundColor || undefined}
        name={displayTitle}
        title={displayTitle}
        avatar={
          isInbox
            ? avatar && avatar !== DEFAULT_INBOX_AVATAR
              ? avatar
              : defaultAgentMeta.avatar || DEFAULT_INBOX_AVATAR
            : avatar || DEFAULT_AVATAR
        }
      />
    </SwitchPanel>
  );
});

export default Agent;
