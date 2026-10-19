'use client';

import { Empty } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { useState } from 'react';

import type { WorkspaceTool } from './CollectionsPanel';
import LaunchPanel from './LaunchPanel';
import { workspaceStyles as styles } from './workspaceStyles';

const WebWorkspace = ({ tools, initialToolId }: { tools: WorkspaceTool[]; initialToolId?: string }) => {
  const [selectedId, setSelectedId] = useState(initialToolId ?? '');
  const tool = tools.find((tool) => tool.id === selectedId);
  return <div className={styles.body}>
    <div className={styles.toolbar}>
      <label className={styles.field} style={{ width: '100%', maxWidth: 560 }}><span>工作区工具</span><Select options={tools.map((tool) => ({ label: tool.name, value: tool.id }))} style={{ width: '100%' }} value={selectedId} onChange={(value) => setSelectedId(value ?? '')} /></label>
    </div>
    {tool ? <LaunchPanel key={tool.id} toolId={tool.id} toolName={tool.name} /> : <Empty description="请选择工具" />}
  </div>;
};

export default WebWorkspace;
