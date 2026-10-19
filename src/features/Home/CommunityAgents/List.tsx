'use client';

import { memo } from 'react';

import { recommendedLocalAssistants } from '@/features/LocalAssistantMarket/catalog';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import CommunityAgentItem from './Item';

const CommunityAgentsList = memo(() => (
  <>
    {recommendedLocalAssistants.slice(0, 12).map((entry) => (
      <WorkspaceLink
        key={entry.identifier}
        style={{ color: 'inherit', textDecoration: 'none' }}
        to={`/community/agent/${entry.identifier}`}
      >
        <CommunityAgentItem {...entry.meta} author="secsgem.com.cn" />
      </WorkspaceLink>
    ))}
  </>
));

export default CommunityAgentsList;
