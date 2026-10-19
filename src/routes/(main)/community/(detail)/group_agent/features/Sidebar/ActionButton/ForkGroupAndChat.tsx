'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { customAlphabet } from 'nanoid/non-secure';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useBrand } from '@/features/Brand';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { chatGroupService } from '@/services/chatGroup';
import { discoverService } from '@/services/discover';
import { useAgentGroupStore } from '@/store/agentGroup';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  buttonGroup: css`
    width: 100%;
  `,
  forkButton: css`
    flex: 1;
    width: unset;
    border-start-start-radius: 0 !important;
    border-end-start-radius: 0 !important;
  `,
  // Match Button type="primary" on the right so the two halves read as one
  // pill. (colorPrimary bg + colorBgLayout text) auto-flips with the theme:
  // dark bg + near-white text in light theme, white bg + near-black text
  // in dark theme. We use colorBgLayout directly instead of the
  // semantically-named colorTextLightSolid because the cssVar proxy doesn't
  // pick up LobeHub's JS-level override of that token.
  visibilitySelect: css`
    width: 130px;
    border-color: ${cssVar.colorPrimary} !important;
    border-inline-end-width: 0 !important;
    border-start-end-radius: 0 !important;
    border-end-end-radius: 0 !important;

    color: ${cssVar.colorBgLayout} !important;

    background: ${cssVar.colorPrimary} !important;

    & svg {
      color: ${cssVar.colorBgLayout};
    }

    &:hover:not([data-disabled]) {
      border-color: ${cssVar.colorPrimaryHover} !important;
      background: ${cssVar.colorPrimaryHover} !important;
    }

    &:active:not([data-disabled]) {
      border-color: ${cssVar.colorPrimaryActive} !important;
      background: ${cssVar.colorPrimaryActive} !important;
    }
  `,
}));

/**
 * Generate a market identifier (8-character lowercase alphanumeric string)
 */
const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

type ForkTarget = 'private' | 'public';

const ForkGroupAndChat = memo<{ mobile?: boolean }>(() => {
  const {
    avatar,
    backgroundColor,
    description,
    tags,
    title,
    config,
    identifier,
    memberAgents = [],
  } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);

  const { t } = useTranslation('discover');
  const brand = useBrand();
  const navigate = useWorkspaceAwareNavigate();
  const loadGroups = useAgentGroupStore((s) => s.loadGroups);
  const { allowed: canCreate } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const [visibility, setVisibility] = useState<ForkTarget>('private');

  const meta = {
    avatar,
    backgroundColor,
    description,
    tags,
    title,
  };

  const handleForkAndChat = async (target: ForkTarget = 'private') => {
    if (!canCreate || isLoading) return;

    try {
      setIsLoading(true);

      // Step 1: Check if user has already forked this group
      const existingGroupId = await chatGroupService.getGroupByForkedFromIdentifier(identifier!);

      if (existingGroupId) {
        // User has already forked this group, navigate to existing fork
        toast.info(t('fork.alreadyForked'));
        navigate(urlJoin('/group', existingGroupId));
        return;
      }

      if (!config) {
        toast.error(
          t('groupAgents.noConfig', { defaultValue: 'Group configuration not available' }),
        );
        return;
      }

      // Generate a unique identifier for the forked group
      const newIdentifier = generateMarketIdentifier();

      // Step 2: Find supervisor from memberAgents
      const supervisorMember = memberAgents.find((member: any) => {
        const agent = member.agent || member;
        const role = member.role || agent.role;
        return role === 'supervisor';
      });

      // Prepare supervisor config
      let supervisorConfig;
      if (supervisorMember) {
        const member = supervisorMember as any;
        const agent = member.agent || member;
        const currentVersion = member.currentVersion || member;
        const rawConfig = {
          avatar: currentVersion.avatar,
          backgroundColor: currentVersion.backgroundColor,
          chatConfig: currentVersion.config?.chatConfig || currentVersion.chatConfig,
          description: currentVersion.description,
          model: currentVersion.config?.model || currentVersion.model,
          params: currentVersion.config?.params || currentVersion.params,
          plugins: currentVersion.config?.plugins || currentVersion.plugins,
          provider: currentVersion.config?.provider || currentVersion.provider,
          systemRole:
            currentVersion.config?.systemRole ||
            currentVersion.config?.systemPrompt ||
            currentVersion.systemRole ||
            currentVersion.content,
          tags: currentVersion.tags,
          title: currentVersion.name || agent.name || 'Supervisor',
        };
        // Filter out null/undefined values
        supervisorConfig = Object.fromEntries(
          Object.entries(rawConfig).filter(([_, v]) => v != null),
        );
      }

      // Step 3: Prepare group config. ComHub keeps this local so users do not
      // need to create an upstream community profile before chatting. `target`
      // selects the private or workspace-shared bucket when a workspace is active.
      const groupConfig = {
        config: {
          ...config,
          forkedFromIdentifier: identifier, // Store the source group identifier
        },
        // Group content is the supervisor's systemRole (for backward compatibility)
        content: config.systemRole || supervisorConfig?.systemRole,
        ...meta,
        // Store marketIdentifier at top-level (same as agents)
        marketIdentifier: newIdentifier,
        ...(activeWorkspaceId ? { visibility: target } : {}),
      };

      // Step 4: Prepare member agents from market data
      // Filter out supervisor role as it will be created separately using supervisorConfig
      const members = memberAgents
        .filter((member: any) => {
          const agent = member.agent || member;
          const role = member.role || agent.role;
          return role !== 'supervisor';
        })
        .map((member: any) => {
          const agent = member.agent || member;
          const currentVersion = member.currentVersion || member;
          return {
            avatar: currentVersion.avatar,
            backgroundColor: currentVersion.backgroundColor,
            chatConfig: currentVersion.config?.chatConfig || currentVersion.chatConfig,
            description: currentVersion.description,
            model: currentVersion.config?.model || currentVersion.model,
            plugins: currentVersion.config?.plugins || currentVersion.plugins,
            provider: currentVersion.config?.provider || currentVersion.provider,
            systemRole:
              currentVersion.config?.systemRole ||
              currentVersion.config?.systemPrompt ||
              currentVersion.systemRole ||
              currentVersion.content,
            tags: currentVersion.tags,
            title: currentVersion.name || agent.name,
          };
        });

      // Step 5: Create group with all members in one request
      const result = await chatGroupService.createGroupWithMembers(
        groupConfig,
        members,
        supervisorConfig,
      );

      // Refresh group list
      await loadGroups();

      // Step 6: Report fork event (using 'add' event type)
      discoverService.reportAgentEvent({
        event: 'add',
        identifier: newIdentifier,
        source: location.pathname,
      });

      toast.success(t('fork.success'));

      // Step 7: Navigate to chat
      navigate(urlJoin('/group', result.groupId));
    } catch (error: any) {
      console.error('Fork group failed:', error);
      toast.error(t('fork.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Personal mode: plain primary button, no Private/Public choice to make.
  if (!activeWorkspaceId) {
    return (
      <Button
        block
        className={styles.buttonGroup}
        disabled={!canCreate}
        loading={isLoading}
        size={'large'}
        type={'primary'}
        onClick={() => handleForkAndChat('private')}
      >
        {brand.communityForkAndChatLabel || t('fork.forkAndChat')}
      </Button>
    );
  }

  // Workspace mode: Select on the left chooses Private (default) vs Public,
  // primary button on the right runs the fork. Mirrors ForkAndChat.tsx so
  // both flows look and behave the same way.
  const visibilityOptions = [
    { label: t('fork.visibilityPrivate'), value: 'private' },
    { label: t('fork.visibilityPublic'), value: 'public' },
  ];

  return (
    <Flexbox horizontal className={styles.buttonGroup} gap={0}>
      <Select
        className={styles.visibilitySelect}
        disabled={!canCreate || isLoading}
        options={visibilityOptions}
        size={'large'}
        value={visibility}
        onChange={(v) => setVisibility(v as ForkTarget)}
      />
      <Button
        block
        className={styles.forkButton}
        disabled={!canCreate}
        loading={isLoading}
        size={'large'}
        type={'primary'}
        onClick={() => handleForkAndChat(visibility)}
      >
        {brand.communityForkAndChatLabel || t('fork.forkAndChat')}
      </Button>
    </Flexbox>
  );
});

export default ForkGroupAndChat;
