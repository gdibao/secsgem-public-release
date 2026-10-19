'use client';

import { Tooltip } from '@lobehub/ui';
import { Button, confirmModal, Input, InputNumber, Select } from '@lobehub/ui/base-ui';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { collectionDraft, entryKey, moveEntryInGroup, moveItem, ordered, removeGroup } from './collectionEditing';
import EndpointPreference from './EndpointPreference';
import { workspaceStyles as styles } from './workspaceStyles';
import { type CollectionWrite, type EngineeringCollection, workspaceError } from './workspaceTypes';

interface Props {
  collection?: EngineeringCollection;
  onCancel: () => void;
  onSave: (draft: CollectionWrite) => Promise<unknown>;
  tools: { id: string; name: string }[];
}

const CollectionEditor = ({ collection, onCancel, onSave, tools }: Props) => {
  const [draft, setDraft] = useState(() => collectionDraft(collection));
  const [groupName, setGroupName] = useState('');
  const [addingTool, setAddingTool] = useState<string>();
  const [addingGroup, setAddingGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entries = ordered(draft.entries);
  const groups = ordered(draft.groups);
  const save = async () => {
    setBusy(true);
    setError('');
    try { await onSave(draft); }
    catch (error) { setError(workspaceError(error)); }
    finally { setBusy(false); }
  };
  const directionButton = (label: string, disabled: boolean, direction: -1 | 1, onClick: () => void) =>
    <Tooltip title={label}><Button aria-label={label} disabled={busy || disabled} icon={direction === -1 ? <ArrowUp size={16} /> : <ArrowDown size={16} />} onClick={onClick} /></Tooltip>;

  return <section aria-label="收藏夹编辑" className={styles.editor}>
    <fieldset disabled={busy} style={{ border: 0, display: 'contents', margin: 0, padding: 0 }}>
    <label className={styles.field}><span>收藏夹名称</span><Input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className={styles.field}><span>收藏夹排序</span><InputNumber max={100000} min={0} value={draft.sortOrder} onChange={(value) => setDraft({ ...draft, sortOrder: value ?? 0 })} /></label>
    <div className={styles.full}>
      <h3>分组</h3>
      {groups.map((group, index) => <div className={styles.row} key={group.id}>
        <Input aria-label={`分组名称 ${index + 1}`} maxLength={120} style={{ flex: '1 1 180px' }} value={group.name} onChange={(event) => setDraft({ ...draft, groups: draft.groups.map((item) => item.id === group.id ? { ...item, name: event.target.value } : item) })} />
        {directionButton(`上移分组 ${group.name}`, index === 0, -1, () => setDraft({ ...draft, groups: moveItem(draft.groups, index, -1) }))}
        {directionButton(`下移分组 ${group.name}`, index === groups.length - 1, 1, () => setDraft({ ...draft, groups: moveItem(draft.groups, index, 1) }))}
        <Tooltip title="删除分组"><Button danger aria-label={`删除分组 ${group.name}`} disabled={busy} icon={<Trash2 size={16} />} onClick={() => confirmModal({ title: '删除分组及组内收藏？其他分组保持不变。', onOk: () => setDraft((previous) => removeGroup(previous, group.id)) })} /></Tooltip>
      </div>)}
      <div className={styles.toolbar}>
        <Input aria-label="新分组名称" maxLength={120} style={{ flex: '1 1 180px' }} value={groupName} onChange={(event) => setGroupName(event.target.value)} />
        <Button disabled={busy || !groupName.trim() || groups.length >= 100} icon={<Plus size={16} />} onClick={() => { setDraft({ ...draft, groups: [...draft.groups, { id: crypto.randomUUID(), name: groupName.trim(), sortOrder: groups.length }] }); setGroupName(''); }}>新增分组</Button>
      </div>
      <h3>收藏工具</h3>
      {entries.map((entry) => {
        const tool = tools.find((tool) => tool.id === entry.toolId);
        const key = entryKey(entry);
        const groupEntries = entries.filter((item) => item.groupId === entry.groupId);
        const groupIndex = groupEntries.findIndex((item) => entryKey(item) === key);
        const edit = (patch: Partial<typeof entry>) => setDraft({ ...draft, entries: draft.entries.map((item) => entryKey(item) === key ? { ...item, ...patch } : item) });
        return <section aria-label={`编辑收藏 ${tool?.name ?? entry.toolId}`} className={styles.editor} key={key}>
          <strong className={styles.full}>{tool?.name ?? `${entry.toolId}（目录不可用）`}</strong>
          <label className={styles.field}><span>别名</span><Input aria-label={`${entry.toolId} 别名`} maxLength={120} value={entry.alias ?? ''} onChange={(event) => edit({ alias: event.target.value || null })} /></label>
          <label className={styles.field}><span>分组</span><Select aria-label={`${entry.toolId} 分组`} options={[{ label: '未分组', value: '' }, ...groups.map((group) => ({ label: group.name, value: group.id }))].map((option) => ({ ...option, disabled: draft.entries.some((other) => entryKey(other) !== key && other.toolId === entry.toolId && other.groupId === (option.value || null)) }))} value={entry.groupId ?? ''} onChange={(value) => edit({ groupId: value || null })} /></label>
          <div className={`${styles.field} ${styles.full}`}><EndpointPreference disabled={busy} toolId={entry.toolId} value={entry.defaultEndpointId} onChange={(value) => edit({ defaultEndpointId: value })} /></div>
          <div className={`${styles.toolbar} ${styles.full}`}>
            {directionButton(`上移收藏 ${entry.alias || tool?.name || entry.toolId}`, groupIndex === 0, -1, () => setDraft({ ...draft, entries: moveEntryInGroup(draft.entries, key, -1) }))}
            {directionButton(`下移收藏 ${entry.alias || tool?.name || entry.toolId}`, groupIndex === groupEntries.length - 1, 1, () => setDraft({ ...draft, entries: moveEntryInGroup(draft.entries, key, 1) }))}
            <Tooltip title="取消收藏"><Button danger aria-label={`取消收藏 ${tool?.name ?? entry.toolId}`} disabled={busy} icon={<Trash2 size={16} />} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((item) => entryKey(item) !== key) })} /></Tooltip>
          </div>
        </section>;
      })}
      <div className={styles.toolbar}>
        <label className={styles.field}><span>加入分组</span><Select options={[{ label: '未分组', value: '' }, ...groups.map((group) => ({ label: group.name, value: group.id }))]} value={addingGroup} onChange={(value) => { setAddingGroup(value ?? ''); setAddingTool(undefined); }} /></label>
        <label className={styles.field} style={{ flex: '1 1 180px' }}><span>添加收藏工具</span><Select options={tools.filter((tool) => !entries.some((entry) => entry.toolId === tool.id && entry.groupId === (addingGroup || null))).map((tool) => ({ label: tool.name, value: tool.id }))} value={addingTool} onChange={(value) => setAddingTool(value ?? undefined)} /></label>
        <Button disabled={busy || !addingTool || entries.length >= 500} icon={<Plus size={16} />} onClick={() => { if (!addingTool) return; setDraft({ ...draft, entries: [...draft.entries, { toolId: addingTool, alias: null, defaultEndpointId: null, groupId: addingGroup || null, sortOrder: entries.length }] }); setAddingTool(undefined); }}>加入收藏夹</Button>
      </div>
    </div>
    {error && <p className={styles.full} role="alert">{error}</p>}
    <div className={`${styles.toolbar} ${styles.full}`}>
      <Button disabled={!draft.name.trim() || groups.some((group) => !group.name.trim())} icon={<Save size={16} />} loading={busy} type="primary" onClick={() => void save()}>保存收藏夹</Button>
      <Button disabled={busy} icon={<X size={16} />} onClick={onCancel}>取消</Button>
    </div>
    </fieldset>
  </section>;
};

export default CollectionEditor;
