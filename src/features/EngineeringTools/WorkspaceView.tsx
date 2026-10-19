'use client';

import { Tabs } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import CollectionsPanel, { type WorkspaceTool } from './CollectionsPanel';
import LocalMcpPanel from './LocalMcpPanel';

const WorkspaceView = ({ tools, view, onLaunch }: { tools: WorkspaceTool[]; view: 'favorites' | 'local_mcp'; onLaunch: (toolId: string, endpointId: string | null) => void }) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { workspaceSlug } = useParams<{ workspaceSlug?: string }>();
  const [pane, setPane] = useState<'personal' | 'shared'>('personal');
  const key = JSON.stringify([userId, workspaceSlug, workspaceId]);
  if (view === 'local_mcp') return <LocalMcpPanel />;
  return <>
    <div style={{ minWidth: 0, overflowX: 'auto', flexShrink: 0 }}><Tabs activeKey={pane} items={[
      { key: 'personal', label: '个人收藏夹' }, { key: 'shared', label: '工作区共享' },
    ]} onChange={(next) => setPane(next as typeof pane)} /></div>
    <CollectionsPanel key={`${key}:${pane}`} shared={pane === 'shared'} tools={tools} onLaunch={onLaunch} />
  </>;
};

export default WorkspaceView;
