'use client';

import { Button, confirmModal, Tag } from '@lobehub/ui/base-ui';
import { Table } from 'antd';
import { Pencil, Plus, PowerOff } from 'lucide-react';
import { useState } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { engineeringWorkspaceService as service } from '@/services/engineeringWorkspace';

import EndpointEditor from './EndpointEditor';
import { useFetchAdminEndpoints } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { endpointModeLabels, type EngineeringEndpoint, licenseLabels, workspaceError } from './workspaceTypes';

const AdminEndpoints = ({ canWrite, tools }: { canWrite: boolean; tools: { id: string; name: string }[] }) => {
  const { data, error, isLoading, mutate } = useFetchAdminEndpoints();
  const [editing, setEditing] = useState<EngineeringEndpoint | 'new'>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const disable = async (endpoint: EngineeringEndpoint) => {
    setBusy(true); setFailure('');
    try { await service.adminDisableEndpoint({ id: endpoint.id, expectedVersion: endpoint.version }); await mutate(); }
    catch (error) { setFailure(workspaceError(error)); }
    finally { setBusy(false); }
  };
  return <>
    <div className={styles.toolbar}>
      {canWrite && <Button disabled={busy || !!editing} icon={<Plus size={16} />} onClick={() => setEditing('new')}>新增端点</Button>}
      <Button disabled={busy} onClick={() => void mutate()}>刷新端点</Button>
    </div>
    {failure && <p role="alert">{failure}</p>}
    <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Table dataSource={data ?? []} pagination={{ pageSize: 20 }} rowKey="id" size="small" columns={[
          { title: '端点', key: 'title', render: (_, row: EngineeringEndpoint) => <div style={{ minWidth: 140, overflowWrap: 'anywhere' }}><strong>{row.title}</strong><div>{tools.find((tool) => tool.id === row.toolId)?.name ?? row.toolId}</div></div> },
          { title: '接入方式', key: 'mode', render: (_, row: EngineeringEndpoint) => endpointModeLabels[row.mode] },
          { title: '许可', key: 'license', render: (_, row: EngineeringEndpoint) => <Tag>{licenseLabels[row.licenseState]}</Tag> },
          { title: '状态', key: 'enabled', render: (_, row: EngineeringEndpoint) => row.enabled ? '启用' : '停用' },
          { title: '版本', dataIndex: 'version', key: 'version' },
          { title: '操作', key: 'actions', render: (_, row: EngineeringEndpoint) => canWrite && <div className={styles.toolbar}>
            <Button aria-label={`编辑端点 ${row.title}`} disabled={busy || !!editing} icon={<Pencil size={16} />} title="编辑端点" onClick={() => setEditing(row)} />
            <Button danger aria-label={`停用端点 ${row.title}`} disabled={busy || !row.enabled} icon={<PowerOff size={16} />} title="停用端点" onClick={() => confirmModal({ title: '停用此端点？已保存的默认入口将不可启动。', onOk: () => disable(row) })} />
          </div> },
        ]} />
      </div>
    </AsyncBoundary>
    {editing && canWrite && <EndpointEditor endpoint={editing === 'new' ? undefined : editing} key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} tools={tools} onCancel={() => setEditing(undefined)} onSave={async (draft) => { await service.adminSaveEndpoint(draft); setEditing(undefined); await mutate(); }} />}
  </>;
};

export default AdminEndpoints;
