'use client';

import { Empty } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { engineeringWorkspaceService as service } from '@/services/engineeringWorkspace';

import { entryKey, ordered } from './collectionEditing';
import CollectionEditor from './CollectionEditor';
import LaunchPanel from './LaunchPanel';
import { useEngineeringWorkspaceScope, useFetchPersonalCollections, useFetchSharedCollections } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { type CollectionWrite, type EngineeringCollection, workspaceError } from './workspaceTypes';

export interface WorkspaceTool { accessState?: string; enabled?: boolean; id: string; launchUrl?: string | null; name: string }

const CollectionsPanel = ({ tools, shared = false, onLaunch }: { tools: WorkspaceTool[]; shared?: boolean; onLaunch?: (toolId: string, endpointId: string | null) => void }) => {
  const personal = useFetchPersonalCollections();
  const workspace = useFetchSharedCollections(shared);
  const response = shared ? workspace : personal;
  const { ready } = useEngineeringWorkspaceScope();
  const { data, error, isLoading, mutate } = response;
  const canEdit = ready && (!shared || workspace.canEdit);
  const [editing, setEditing] = useState<EngineeringCollection | 'new'>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [launch, setLaunch] = useState<{ tool: WorkspaceTool; endpointId: string | null; key: string }>();
  const save = shared ? service.saveShared : service.savePersonal;
  const remove = shared ? service.removeShared : service.removePersonal;
  const collections = ordered(data ?? []);
  const launchTool = launch && tools.find((tool) => tool.id === launch.tool.id);
  const mutateCollection = async (operation: () => Promise<unknown>) => {
    if (!ready) return;
    setBusy(true); setFailure('');
    try { await operation(); await mutate(); }
    catch (error) { setFailure(workspaceError(error)); }
    finally { setBusy(false); }
  };
  if (shared && !workspace.available) return <Empty description="请先进入有权限的工作区查看共享工具集" />;
  if (!ready) return <Empty description="工作区加载中，收藏夹暂不可用" />;
  return <div className={styles.body}>
    <div className={styles.toolbar}>
      {canEdit && <Button disabled={busy || !!editing} icon={<Plus size={16} />} onClick={() => setEditing('new')}>新建收藏夹</Button>}
      <Button disabled={busy} onClick={() => void mutate()}>刷新收藏夹</Button>
      {shared && !canEdit && <span className={styles.muted}>工作区共享工具集 · 只读</span>}
    </div>
    {failure && <p role="alert">{failure}</p>}
    {editing && canEdit && <CollectionEditor collection={editing === 'new' ? undefined : editing} key={editing === 'new' ? 'new' : editing.id} tools={tools} onCancel={() => setEditing(undefined)} onSave={async (draft: CollectionWrite) => { if (!ready) return; await save(draft); setEditing(undefined); await mutate(); }} />}
    <AsyncBoundary data={data} empty={<Empty description="暂无收藏夹" />} error={error} isEmpty={data?.length === 0} isLoading={isLoading} onRetry={() => void mutate()}>
      {collections.map((collection) => <section key={collection.id}>
        <div className={styles.row}>
          <h2 style={{ flex: '1 1 180px', fontSize: 20, margin: 0 }}>{collection.name}</h2>
          {canEdit && <>
            <Button aria-label={`编辑收藏夹 ${collection.name}`} disabled={busy || !!editing} icon={<Pencil size={16} />} title="编辑收藏夹" onClick={() => setEditing(collection)} />
            <Button danger aria-label={`删除收藏夹 ${collection.name}`} disabled={busy || !!editing} icon={<Trash2 size={16} />} title="删除收藏夹" onClick={() => confirmModal({ title: '删除收藏夹及其中的收藏？目录工具保持不变。', onOk: () => mutateCollection(() => remove({ id: collection.id, expectedVersion: collection.version })) })} />
          </>}
        </div>
        {[{ id: null, name: '未分组' }, ...ordered(collection.groups)].map((group) => <section key={group.id ?? 'ungrouped'}>
          <h3>{group.name}</h3>
          {ordered(collection.entries).filter((entry) => entry.groupId === group.id).map((entry) => {
            const tool = tools.find((tool) => tool.id === entry.toolId);
            return <div className={styles.row} key={entryKey(entry)}>
              <div style={{ flex: '1 1 180px' }}><strong>{entry.alias || tool?.name || entry.toolId}</strong>{entry.alias && <div className={styles.muted}>{tool?.name ?? entry.toolId}</div>}{!tool && <div role="status">目录不可用，已保留收藏</div>}{tool?.enabled === false && <div role="status">历史归档，不能启动</div>}</div>
              <Button disabled={!tool || tool.enabled === false} onClick={() => { if (tool && tool.enabled !== false) {
                if (onLaunch) onLaunch(tool.id, entry.defaultEndpointId);
                else setLaunch({ tool, endpointId: entry.defaultEndpointId, key: `${collection.id}:${entryKey(entry)}` });
              } }}>选择并启动</Button>
            </div>;
          })}
        </section>)}
      </section>)}
    </AsyncBoundary>
    {!onLaunch && launch && launchTool && launchTool.enabled !== false && <LaunchPanel defaultEndpointId={launch.endpointId} key={launch.key} toolId={launchTool.id} toolName={launchTool.name} />}
  </div>;
};

export default CollectionsPanel;
