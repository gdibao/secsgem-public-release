'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Checkbox, confirmModal, Input, InputNumber, Select, Tabs, toast } from '@lobehub/ui/base-ui';
import { Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { AdminPageShell } from '@/features/Admin/layout';
import AdminEndpoints from '@/features/EngineeringTools/AdminEndpoints';
import SubmissionReviewPanel from '@/features/EngineeringTools/SubmissionReviewPanel';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

type Tool = Awaited<ReturnType<typeof lambdaClient.engineeringTools.adminList.query>>[number];
type EditableTool = Omit<Tool, 'importBatchId'> & { publicReason?: string };
type MenuItem = NonNullable<Awaited<ReturnType<typeof lambdaClient.engineeringTools.adminMenu.query>>>[number];
type Vocabulary = Awaited<ReturnType<typeof lambdaClient.engineeringTools.adminVocabulary.query>>;

const vocabularyFields = {
  accessState: ['accessStates', '接入状态'], forms: ['forms', '运行形态'],
  licenseType: ['licenseTypes', '许可性质'], maintainerName: ['maintainerNames', '维护组织'],
  pricingType: ['pricingTypes', '收费方式'], projectPhases: ['projectPhases', '工作阶段'],
  subsystems: ['subsystems', '子系统'], supportedOS: ['operatingSystems', '支持系统'],
  vendorName: ['vendorNames', '厂商'],
} as const;
type VocabularyField = keyof typeof vocabularyFields;

const styles = createStaticStyles(({ css, cssVar }) => ({
  editor: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    border-top: 1px solid ${cssVar.colorBorderSecondary};
    padding-block: 18px;
    @media (width < 720px) { grid-template-columns: minmax(0, 1fr); }
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  full: css`grid-column: 1 / -1;`,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 14px;
  `,
}));

const emptyTool = (): EditableTool => ({
  availability: '未配置/未安装',
  category: '',
  description: '',
  developerOnly: false,
  enabled: false,
  id: '',
  launchUrl: null,
  license: '待核',
  name: '',
  publicReason: '',
  section: 'process',
  shape: 'unknown',
  sortOrder: 0,
  sourceUrl: '',
  summary: '',
});

const AdminEngineeringToolsPage = () => {
  const role = useUserStore((state) => userProfileSelectors.userProfile(state)?.role);
  const canWrite = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppWrite);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditableTool | null>(null);
  const [newTool, setNewTool] = useState(false);
  const [menuEditing, setMenuEditing] = useState<MenuItem[] | null>(null);
  const [menuDraftVersion, setMenuDraftVersion] = useState<number | null>(null);
  const [menuConflict, setMenuConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rollbackBatch, setRollbackBatch] = useState('');
  const [vocabularyEditing, setVocabularyEditing] = useState<Vocabulary | null>(null);
  const [vocabularyField, setVocabularyField] = useState<VocabularyField>('subsystems');
  const [newTerm, setNewTerm] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const { data: tools, error, mutate } = useSWR('engineering-tools-admin-list', () => lambdaClient.engineeringTools.adminList.query());
  const { data: menuState, mutate: mutateMenu } = useSWR('engineering-tools-admin-menu-state', () => lambdaClient.engineeringTools.adminMenuState.query());
  const menu = menuState?.items;
  const { data: vocabulary, mutate: mutateVocabulary } = useSWR('engineering-tools-admin-vocabulary', () => lambdaClient.engineeringTools.adminVocabulary.query());
  const filtered = useMemo(() => (tools ?? []).filter((tool) => `${tool.id} ${tool.name} ${tool.category}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [tools, query]);

  const saveTool = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await lambdaClient.engineeringTools.save.mutate(editing);
      toast.success('已保存，刷新目录即可看到变更');
      setEditing(null);
      setNewTool(false);
      await mutate();
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const removeTool = async (id: string) => {
    setBusy(true);
    try {
      await lambdaClient.engineeringTools.remove.mutate({ id });
      toast.success('已删除');
      await mutate();
    } catch (error) { toast.error(error instanceof Error ? error.message : '删除失败'); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const payload = JSON.parse(await file.text());
      if (Array.isArray(payload.entries) && payload.vocabularies) {
        const batchId = payload.batchId ?? `${payload.schemaVersion}-${payload.asOf}`;
        const result = await lambdaClient.engineeringTools.importFacets.mutate({
          batchId, entries: payload.entries, vocabularies: payload.vocabularies,
        });
        toast.success(`补充 ${result.updated} 条缺失分类；已有人工字段未覆盖`);
        await Promise.all([mutate(), mutateVocabulary()]);
      } else {
        const result = await lambdaClient.engineeringTools.importMissing.mutate(payload);
        toast.success(`新增 ${result.inserted} 条；已存在条目保持不变`);
        await Promise.all([mutate(), mutateMenu()]);
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = ''; }
  };
  const saveVocabulary = async () => {
    if (!vocabularyEditing) return;
    setBusy(true);
    try {
      await lambdaClient.engineeringTools.saveVocabulary.mutate(vocabularyEditing);
      toast.success('词表已保存，刷新目录即可生效');
      setVocabularyEditing(null);
      await mutateVocabulary();
    } catch (error) { toast.error(error instanceof Error ? error.message : '词表保存失败'); }
    finally { setBusy(false); }
  };
  const editMenuItem = (index: number, update: (item: MenuItem) => MenuItem) => {
    setMenuDraftVersion((previous) => previous ?? menuState?.version ?? 0);
    setMenuEditing((previous) => (previous ?? menu ?? []).map((item, at) => at === index ? update(item) : item));
  };
  const saveMenu = async () => {
    if (!menu || !menuEditing || menuConflict) return;
    setBusy(true);
    try {
      await lambdaClient.engineeringTools.saveMenuCAS.mutate({
        expectedVersion: menuDraftVersion ?? menuState?.version ?? 0,
        items: menuEditing,
      });
      toast.success('菜单已保存');
      setMenuEditing(null);
      setMenuDraftVersion(null);
      setMenuConflict(false);
      await mutateMenu();
    } catch (error) {
      if ((error as { data?: { code?: string } })?.data?.code === 'CONFLICT') {
        setMenuConflict(true);
        await mutateMenu();
      } else toast.error(error instanceof Error ? error.message : '保存失败');
    } finally { setBusy(false); }
  };
  const editField = <K extends keyof EditableTool>(key: K, value: EditableTool[K]) =>
    setEditing((previous) => previous ? { ...previous, [key]: value } : previous);
  const field = (label: string, key: keyof EditableTool, full = false) => (
    <label className={`${styles.field} ${full ? styles.full : ''}`} key={key}>
      <span>{label}</span>
      <Input disabled={key === 'id' && !newTool} value={String(editing?.[key] ?? '')} onChange={(event) => editField(key, (key === 'launchUrl' ? event.target.value || null : ['officialWebsiteUrl', 'productUrl', 'purchaseUrl'].includes(key) ? event.target.value || undefined : event.target.value) as never)} />
    </label>
  );
  const vocabularyOptions = (key: keyof Vocabulary, selected: string[] = []) =>
    [...new Set([...(Array.isArray(vocabulary?.[key]) ? vocabulary[key] as string[] : []), ...selected])]
      .map((value) => ({ label: value, value }));
  const multiField = (label: string, key: 'forms' | 'projectPhases' | 'subsystems' | 'supportedOS', vocabKey: keyof Vocabulary) => (
    <label className={styles.field} key={key}><span>{label}</span><Select
      mode="multiple" options={vocabularyOptions(vocabKey, editing?.[key] ?? [])}
      value={editing?.[key] ?? []} onChange={(value) => editField(key, Array.isArray(value) ? value : value ? [value] : [])}
    /></label>
  );
  const singleFacet = (label: string, key: 'accessState' | 'licenseType' | 'maintainerName' | 'pricingType' | 'vendorName', vocabKey: keyof Vocabulary) => (
    <label className={styles.field} key={key}><span>{label}</span><Select
      allowClear options={vocabularyOptions(vocabKey, editing?.[key] ? [editing[key]] : [])}
      value={editing?.[key]} onChange={(value) => editField(key, value ?? undefined)}
    /></label>
  );

  return (
    <AdminPageShell description="维护工程工具、入口与目录顺序；保存后无需构建" title="工程工具目录">
      <Tabs items={[
        { key: 'tools', label: '工具目录', children: <>
          <div className={styles.toolbar}>
            <Input allowClear placeholder="搜索名称、ID、分类" style={{ maxWidth: 300 }} value={query} onChange={(event) => setQuery(event.target.value)} />
            {canWrite && <Button icon={<Plus size={16} />} onClick={() => { setEditing(emptyTool()); setNewTool(true); }}>新增工具</Button>}
            {canWrite && <><input hidden accept="application/json,.json" aria-label="导入工具或分类 JSON" ref={uploadRef} type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /><Button icon={<Upload size={16} />} loading={busy} onClick={() => uploadRef.current?.click()}>导入缺失条目 / 分类</Button></>}
          </div>
          {error ? <Button onClick={() => mutate()}>加载失败，重试</Button> : <Table
            dataSource={filtered}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            rowKey="id"
            size="small"
            columns={[
              { dataIndex: 'id', key: 'id', title: 'ID', width: 100 },
              { dataIndex: 'name', key: 'name', title: '工具', ellipsis: true },
              { dataIndex: 'category', key: 'category', title: '分类', ellipsis: true },
              { dataIndex: 'shape', key: 'shape', title: '形态', width: 120 },
              { key: 'state', render: (_, row: Tool) => row.enabled ? '启用' : '停用', title: '状态', width: 80 },
              { key: 'actions', render: (_, row: Tool) => canWrite ? <Flexbox horizontal gap={4}>
                <Button aria-label={`编辑 ${row.name}`} icon={<Pencil size={15} />} type="text" onClick={() => { const { importBatchId: _batch, ...rest } = row; setEditing(rest); setNewTool(false); }} />
                <Button danger aria-label={`删除 ${row.name}`} icon={<Trash2 size={15} />} type="text" onClick={() => confirmModal({ title: '确认删除此工具？', onOk: () => removeTool(row.id) })} />
              </Flexbox> : null, title: '操作', width: 96 },
            ]}
          />}
          {canWrite && editing && <section aria-label="工具编辑" className={styles.editor}>
            {field('稳定 ID', 'id')}{field('名称', 'name')}
            <label className={styles.field}><span>主入口</span><Select options={[{ label: '工艺与厂务', value: 'process' }, { label: '自动化与网络', value: 'automation' }, { label: '设计与项目', value: 'design' }]} value={editing.section} onChange={(value) => { if (value) editField('section', value); }} /></label>
            {field('分类', 'category')}
            <label className={styles.field}><span>形态</span><Select options={['web', 'hybrid', 'windows', 'cross-platform', 'device-web', 'sdk', 'unknown'].map((value) => ({ label: value, value }))} value={editing.shape} onChange={(value) => { if (value) editField('shape', value as EditableTool['shape']); }} /></label>
            <label className={styles.field}><span>排序</span><InputNumber min={0} style={{ width: '100%' }} value={editing.sortOrder} onChange={(value) => editField('sortOrder', value ?? 0)} /></label>
            {field('官方来源 URL', 'sourceUrl', true)}{field('已核可运行 Web URL（否则留空）', 'launchUrl', true)}
            {singleFacet('厂商', 'vendorName', 'vendorNames')}{singleFacet('维护组织', 'maintainerName', 'maintainerNames')}
            {multiField('子系统', 'subsystems', 'subsystems')}{multiField('工作阶段', 'projectPhases', 'projectPhases')}
            {multiField('支持系统', 'supportedOS', 'operatingSystems')}{multiField('运行形态', 'forms', 'forms')}
            {singleFacet('许可性质', 'licenseType', 'licenseTypes')}{singleFacet('收费方式', 'pricingType', 'pricingTypes')}
            {singleFacet('接入状态', 'accessState', 'accessStates')}
            {field('企业官网', 'officialWebsiteUrl')}{field('产品页', 'productUrl')}{field('购买渠道（已获授权才填）', 'purchaseUrl', true)}
            {field('简介', 'summary', true)}{field('具体用途与输出', 'description', true)}
            {field('许可与授权', 'license')}{field('安装/接入状态', 'availability')}
            {field('公开归档原因', 'publicReason', true)}
            <Flexbox horizontal gap={16}><Checkbox checked={editing.enabled} onChange={(checked) => editField('enabled', checked)}>启用</Checkbox><Checkbox checked={editing.developerOnly} onChange={(checked) => editField('developerOnly', checked)}>开发与扩展</Checkbox></Flexbox>
            <Flexbox horizontal gap={8}><Button loading={busy} type="primary" onClick={() => void saveTool()}>保存</Button><Button onClick={() => setEditing(null)}>取消</Button></Flexbox>
          </section>}
        </> },
        ...(canWrite ? [{ key: 'review', label: '投稿审核', children: <SubmissionReviewPanel onCatalogChange={() => { void mutate(); }} /> }] : []),
        { key: 'endpoints', label: '工作区端点', children: <AdminEndpoints canWrite={canWrite} tools={tools ?? []} /> },
        { key: 'vocabulary', label: '分类词表', children: <>
          <p>词表值是稳定关联键；显示名、别名和停用状态可调整，历史工具记录不会被改写。</p>
          <div className={styles.toolbar}>
            <Select aria-label="词表维度" options={Object.entries(vocabularyFields).map(([value, [, label]]) => ({ label, value }))} value={vocabularyField} onChange={(value) => setVocabularyField(value as VocabularyField)} />
            {canWrite && <Button onClick={() => setVocabularyEditing(structuredClone(vocabulary ?? {
              accessStates: [], forms: [], licenseTypes: [], maintainerNames: [], operatingSystems: [],
              pricingTypes: [], projectPhases: [], subsystems: [], vendorNames: [],
            }))}>编辑词表</Button>}
          </div>
          {(() => {
            const current = vocabularyEditing ?? vocabulary;
            const [key] = vocabularyFields[vocabularyField];
            return <>
              {canWrite && vocabularyEditing && <div className={styles.toolbar}>
                <Input aria-label="新增词" placeholder="新增稳定值" value={newTerm} onChange={(event) => setNewTerm(event.target.value)} />
                <Button onClick={() => { const value = newTerm.trim(); if (!value) return; setVocabularyEditing((previous) => previous ? { ...previous, [key]: [...new Set([...previous[key], value])] } : previous); setNewTerm(''); }}>添加</Button>
              </div>}
              {(current?.[key] ?? []).map((value) => <div className={styles.toolbar} key={value}>
                <strong style={{ minWidth: 150 }}>{value}</strong>
                <Input aria-label={`${value} 显示名`} disabled={!vocabularyEditing} placeholder="显示名" style={{ width: 190 }} value={current?.labels?.[vocabularyField]?.[value] ?? ''} onChange={(event) => setVocabularyEditing((previous) => {
                  if (!previous) return previous;
                  const labels = { ...previous.labels?.[vocabularyField] };
                  if (event.target.value.trim()) labels[value] = event.target.value;
                  else delete labels[value];
                  return { ...previous, labels: { ...previous.labels, [vocabularyField]: labels } };
                })} />
                <Input aria-label={`${value} 别名`} disabled={!vocabularyEditing} placeholder="搜索别名，逗号分隔" style={{ width: 240 }} value={(current?.aliases?.[vocabularyField]?.[value] ?? []).join(', ')} onChange={(event) => setVocabularyEditing((previous) => previous ? { ...previous, aliases: { ...previous.aliases, [vocabularyField]: { ...previous.aliases?.[vocabularyField], [value]: event.target.value.split(',').map((term) => term.trim()).filter(Boolean) } } } : previous)} />
                <Checkbox checked={!(current?.inactive?.[vocabularyField] ?? []).includes(value)} disabled={!vocabularyEditing} onChange={(checked) => setVocabularyEditing((previous) => previous ? { ...previous, inactive: { ...previous.inactive, [vocabularyField]: checked ? (previous.inactive?.[vocabularyField] ?? []).filter((term) => term !== value) : [...(previous.inactive?.[vocabularyField] ?? []), value] } } : previous)}>启用</Checkbox>
                {vocabularyEditing && <Button danger icon={<Trash2 size={14} />} title={`从词表移除 ${value}`} onClick={() => setVocabularyEditing((previous) => previous ? {
                  ...previous,
                  [key]: previous[key].filter((term) => term !== value),
                  inactive: { ...previous.inactive, [vocabularyField]: [...new Set([...(previous.inactive?.[vocabularyField] ?? []), value])] },
                } : previous)} />}
              </div>)}
              {canWrite && vocabularyEditing && <div className={styles.toolbar}><Button loading={busy} type="primary" onClick={() => void saveVocabulary()}>保存词表</Button><Button onClick={() => setVocabularyEditing(null)}>取消</Button></div>}
            </>;
          })()}
        </> },
        { key: 'menu', label: '侧栏入口', children: <>
          <p>只管理原三个位置，停用不会删除旧功能路由。调整后刷新 Fab 页面生效。</p>
          {!menu?.length && <p>尚未导入菜单配置。先导入目录 JSON，再编辑三个入口。</p>}
          {(menuEditing ?? menu ?? []).map((item, index) => <div className={styles.toolbar} key={item.key}>
            <strong>{item.key}</strong>
            <Input aria-label={`${item.key} 名称`} disabled={!canWrite} style={{ maxWidth: 180 }} value={item.label} onChange={(event) => editMenuItem(index, (entry) => ({ ...entry, label: event.target.value }))} />
            <Input aria-label={`${item.key} 链接`} disabled={!canWrite} style={{ maxWidth: 340 }} value={item.path} onChange={(event) => editMenuItem(index, (entry) => ({ ...entry, path: event.target.value }))} />
            <InputNumber aria-label={`${item.key} 排序`} disabled={!canWrite} min={0} value={item.sortOrder} onChange={(value) => editMenuItem(index, (entry) => ({ ...entry, sortOrder: value ?? 0 }))} />
            <Checkbox checked={item.enabled} disabled={!canWrite} onChange={(checked) => editMenuItem(index, (entry) => ({ ...entry, enabled: checked }))}>启用</Checkbox>
          </div>)}
          {menuConflict && <p role="alert">菜单已被其他管理员修改。本地编辑仍保留；请核对后载入最新配置再修改。</p>}
          {canWrite && menuConflict && <Button onClick={() => { setMenuEditing(null); setMenuDraftVersion(null); setMenuConflict(false); }}>放弃本地编辑并载入最新</Button>}
          {canWrite && !!menu?.length && <Button disabled={!menuEditing || menuConflict} loading={busy} type="primary" onClick={() => void saveMenu()}>保存菜单</Button>}
          {canWrite && <div className={styles.toolbar} style={{ marginTop: 30 }}><Input placeholder="导入批次 ID" style={{ maxWidth: 220 }} value={rollbackBatch} onChange={(event) => setRollbackBatch(event.target.value)} /><Button danger disabled={!rollbackBatch} onClick={() => confirmModal({ title: '仅撤销该批次未被管理员修改的记录，确认？', onOk: async () => { try { const result = await lambdaClient.engineeringTools.rollbackImport.mutate({ batchId: rollbackBatch }); toast.success(`撤销 ${result.removed} 条未修改的导入记录`); await Promise.all([mutate(), mutateMenu()]); } catch (error) { toast.error(error instanceof Error ? error.message : '撤销失败'); } } })}>撤销导入批次</Button></div>}
          {canWrite && <div className={styles.toolbar}><Input placeholder="分类批次 ID" style={{ maxWidth: 220 }} value={rollbackBatch} onChange={(event) => setRollbackBatch(event.target.value)} /><Button danger disabled={!rollbackBatch} onClick={() => confirmModal({ title: '仅移除仍等于导入值的分类字段，确认？', onOk: async () => { try { const result = await lambdaClient.engineeringTools.rollbackFacets.mutate({ batchId: rollbackBatch }); toast.success(`撤销 ${result.fieldsRemoved} 个未修改分类字段`); await Promise.all([mutate(), mutateVocabulary()]); } catch (error) { toast.error(error instanceof Error ? error.message : '撤销失败'); } } })}>撤销分类批次</Button></div>}
        </> },
      ]} />
    </AdminPageShell>
  );
};

export default AdminEngineeringToolsPage;
