'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

export const useCreateAssistant = () => {
  const { t } = useTranslation('common');
  const createAgent = useAgentStore((state) => state.createAgent);
  const refreshAgentList = useHomeStore((state) => state.refreshAgentList);
  const navigate = useWorkspaceAwareNavigate();
  const [creating, setCreating] = useState(false);

  const createAssistant = useCallback(async () => {
    if (creating) return;

    setCreating(true);
    try {
      const { agentId } = await createAgent({});
      void refreshAgentList().catch(() => undefined);
      navigate(`/agent/${encodeURIComponent(agentId)}`);
    } catch {
      toast.error(t('mobile.recent.createAgentError'));
    } finally {
      setCreating(false);
    }
  }, [createAgent, creating, navigate, refreshAgentList, t]);

  return { createAssistant, creating };
};
