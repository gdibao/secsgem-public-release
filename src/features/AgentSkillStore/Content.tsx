'use client';

import { memo } from 'react';

import AgentCapabilityStore from '@/features/LocalMarket/AgentCapabilityStore';

const AgentSkillStoreContent = memo<{ agentId: string }>(({ agentId }) => (
  <AgentCapabilityStore agentId={agentId} />
));

AgentSkillStoreContent.displayName = 'AgentSkillStoreContent';

export default AgentSkillStoreContent;
