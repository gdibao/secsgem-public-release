'use client';

import { Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ActivityIcon, GitBranchIcon, MessageSquareHeartIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { DEFAULT_COMHUB_AGENT_NAME } from '@/const/defaultAgent';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import {
  AgentSettings as Settings,
  SettingsModalLayout,
  type SettingsModalTabItem,
} from '@/features/AgentSetting';
import { useBrand } from '@/features/Brand/BrandProvider';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, settingsSelectors } from '@/store/user/selectors';

const TAB_META = {
  [ChatSettingsTabs.Graph]: { icon: GitBranchIcon, labelKey: 'agentTab.graph' },
  [ChatSettingsTabs.Opening]: { icon: MessageSquareHeartIcon, labelKey: 'agentTab.opening' },
  [ChatSettingsTabs.SelfIteration]: {
    icon: ActivityIcon,
    labelKey: 'agentTab.selfIteration',
  },
} as const;

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const brand = useBrand();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [agentId, isInbox] = useAgentStore(
    (s) => [s.activeAgentId, builtinAgentSelectors.isInboxAgent(s)],
    shallow,
  );
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const defaultAgentMeta = useUserStore(settingsSelectors.defaultAgentMeta);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
  const enableAgentGraphConfigLab = useUserStore(labPreferSelectors.enableAgentGraphConfig);
  const [tab, setTab] = useState(ChatSettingsTabs.Opening);
  const showGraphTab = enableAgentGraphConfigLab && !isInbox && !isHeterogeneous;

  const availableTabs = useMemo(
    () =>
      [
        ChatSettingsTabs.Opening,
        enableAgentSelfIteration ? ChatSettingsTabs.SelfIteration : null,
        showGraphTab ? ChatSettingsTabs.Graph : null,
      ].filter(Boolean) as ChatSettingsTabs[],
    [enableAgentSelfIteration, showGraphTab],
  );

  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];

  useEffect(() => {
    if (activeTab && activeTab !== tab) setTab(activeTab);
  }, [activeTab, tab]);

  const updateAgentConfig = async (nextConfig: any) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, nextConfig);
  };

  const updateAgentMeta = async (nextMeta: any) => {
    if (!canEdit || !agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, nextMeta);
  };

  const tabs: SettingsModalTabItem[] = useMemo(
    () =>
      availableTabs.map((key) => {
        const entry = TAB_META[key as keyof typeof TAB_META];
        return { icon: entry.icon, key, label: t(entry.labelKey) };
      }),
    [availableTabs, t],
  );

  const displayTitle = isInbox
    ? defaultAgentMeta?.title || brand.name || DEFAULT_COMHUB_AGENT_NAME
    : meta.title || t('defaultSession', { ns: 'common' });
  const displayAvatar = isInbox
    ? defaultAgentMeta?.avatar || brand.logoUrl || DEFAULT_INBOX_AVATAR
    : meta.avatar || DEFAULT_AVATAR;

  return (
    <SettingsModalLayout
      activeTab={activeTab}
      avatar={displayAvatar}
      background={meta.backgroundColor || undefined}
      tabs={tabs}
      title={displayTitle}
      onTabChange={(key) => setTab(key as ChatSettingsTabs)}
    >
      {activeTab ? (
        <Settings
          config={config}
          disabled={!canEdit}
          id={agentId}
          loading={false}
          meta={meta}
          tab={activeTab}
          onConfigChange={updateAgentConfig}
          onMetaChange={updateAgentMeta}
        />
      ) : (
        <Flexbox align="center" flex={1} gap={8} justify="center">
          <Text weight={500}>{t('agentTab.empty.title', { defaultValue: 'No settings available' })}</Text>
          <Text type="secondary">
            {t('agentTab.empty.desc', { defaultValue: 'This Agent has no configurable settings.' })}
          </Text>
        </Flexbox>
      )}
    </SettingsModalLayout>
  );
});

export default Content;
