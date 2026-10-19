'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import AgentCapabilityStore from '@/features/LocalMarket/AgentCapabilityStore';

export const createSkillStoreModal = (agentId?: string) =>
  createModal({
    content: <AgentCapabilityStore agentId={agentId} />,
    footer: null,
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(92vw, 980px)',
  });
