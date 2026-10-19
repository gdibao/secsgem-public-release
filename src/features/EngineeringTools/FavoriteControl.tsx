'use client';

import { Button, Input, Select } from '@lobehub/ui/base-ui';
import { Bookmark, BookmarkCheck, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { engineeringWorkspaceService as service } from '@/services/engineeringWorkspace';

import { collectionDraft } from './collectionEditing';
import { useEngineeringWorkspaceScope, useFetchPersonalCollections } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { workspaceError } from './workspaceTypes';

const FavoriteControl = ({ toolId, toolName }: { toolId: string; toolName: string }) => {
  const { data, error, isLoading, mutate } = useFetchPersonalCollections();
  const { ready } = useEngineeringWorkspaceScope();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [groupId, setGroupId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const collection = data?.find((item) => item.id === selected);
  const entry = collection?.entries.find((entry) => entry.toolId === toolId && entry.groupId === (groupId || null));
  const count = data?.reduce((count, item) => count + item.entries.filter((entry) => entry.toolId === toolId).length, 0) ?? 0;
  const update = async () => {
    if (!ready || !collection) return;
    setBusy(true); setFailure('');
    try {
      const draft = collectionDraft(collection);
      await service.savePersonal({ ...draft, entries: entry
        ? draft.entries.filter((item) => !(item.toolId === toolId && item.groupId === (groupId || null)))
        : [...draft.entries, { toolId, groupId: groupId || null, alias: null, defaultEndpointId: null, sortOrder: draft.entries.length }],
      });
      await mutate();
    } catch (error) { setFailure(workspaceError(error)); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!ready) return;
    setBusy(true); setFailure('');
    try {
      const result = await service.savePersonal({ name: newName.trim(), sortOrder: data?.length ?? 0, groups: [], entries: [{ toolId, groupId: null, alias: null, defaultEndpointId: null, sortOrder: 0 }] });
      await mutate(); setSelected(result.id); setNewName(''); setGroupId('');
    } catch (error) { setFailure(workspaceError(error)); }
    finally { setBusy(false); }
  };
  return <>
    <Button aria-expanded={open} aria-label={`${count ? '管理收藏' : '加入收藏'} ${toolName}`} disabled={!ready} icon={count ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} onClick={() => setOpen(!open)}>{count ? `已收藏（${count}）` : '加入收藏'}</Button>
    {open && <section aria-label={`${toolName} 收藏设置`} style={{ maxWidth: '100%', minWidth: 0 }}>
      {isLoading && <span role="status">收藏夹加载中</span>}
      {error && <Button onClick={() => void mutate()}>收藏夹加载失败，重试</Button>}
      <div className={styles.toolbar}>
        <label className={styles.field} style={{ width: '100%' }}><span>{toolName} 收藏夹</span><Select disabled={!ready || busy || !!error || isLoading} options={(data ?? []).map((item) => ({ label: item.name, value: item.id }))} style={{ width: '100%' }} value={selected} onChange={(value) => { setSelected(value ?? ''); setGroupId(''); }} /></label>
        <label className={styles.field} style={{ width: '100%' }}><span>{toolName} 收藏分组</span><Select disabled={busy || !collection} options={[{ label: '未分组', value: '' }, ...(collection?.groups ?? []).map((group) => ({ label: group.name, value: group.id }))]} style={{ width: '100%' }} value={groupId} onChange={(value) => setGroupId(value ?? '')} /></label>
        <Button disabled={!ready || busy || !collection || !!error} onClick={() => void update()}>{entry ? '取消此处收藏' : '收藏到此处'}</Button>
      </div>
      <div className={styles.toolbar}>
        <Input aria-label={`${toolName} 新收藏夹名称`} maxLength={120} placeholder="新收藏夹名称" value={newName} onChange={(event) => setNewName(event.target.value)} />
        <Button disabled={!ready || busy || !data || !!error || !newName.trim()} icon={<Plus size={16} />} onClick={() => void create()}>新建并收藏</Button>
        <Button aria-label={`关闭 ${toolName} 收藏设置`} disabled={busy} icon={<X size={16} />} title="关闭收藏设置" onClick={() => setOpen(false)} />
      </div>
      {failure && <p role="alert">{failure}</p>}
    </section>}
  </>;
};

export default FavoriteControl;
