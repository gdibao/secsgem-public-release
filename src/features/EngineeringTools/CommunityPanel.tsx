'use client';

import { Button, Input, Select, Tabs } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import SubmissionReviewPanel from './SubmissionReviewPanel';
import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { workspaceError } from './workspaceTypes';

type Submission = Awaited<ReturnType<typeof lambdaClient.engineeringTools.listMySubmissions.query>>[number];
type Draft = {
  category: string; description: string; downloadUrl: string; license: string; name: string;
  officialWebsiteUrl: string; pricingType: string; productUrl: string; purchaseUrl: string;
  runUrl: string; section: 'process' | 'automation' | 'design';
  shape: 'web' | 'hybrid' | 'windows' | 'cross-platform' | 'device-web' | 'sdk' | 'unknown';
  summary: string; vendorName: string; visibility: 'public' | 'workspace';
};

const blank: Draft = { category: '', description: '', downloadUrl: '', license: '', name: '',
  officialWebsiteUrl: '', pricingType: '', productUrl: '', purchaseUrl: '', runUrl: '',
  section: 'process', shape: 'unknown', summary: '', vendorName: '', visibility: 'public' };
const statuses = { draft: '草稿', published: '已发布', rejected: '已退回', submitted: '待审核', superseded: '旧版已替换' } as const;
const sections = [{ label: '工艺与厂务', value: 'process' }, { label: '自动化与网络', value: 'automation' }, { label: '设计与项目', value: 'design' }];
const shapes = [
  { label: 'Web', value: 'web' }, { label: 'Web + 桌面', value: 'hybrid' },
  { label: 'Windows 桌面', value: 'windows' }, { label: '跨平台', value: 'cross-platform' },
  { label: '设备 Web', value: 'device-web' }, { label: '库 / SDK', value: 'sdk' },
  { label: '待核', value: 'unknown' },
];

const CommunityPanel = ({ onCatalogChange }: { onCatalogChange: () => void }) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { ready } = useEngineeringWorkspaceScope();
  const [view, setView] = useState<'draft' | 'mine' | 'review'>('draft');
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; version: number }>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const mine = useSWR(userId && ready ? ['engineering-submissions-mine', userId, workspaceId ?? 'global'] : null,
    () => lambdaClient.engineeringTools.listMySubmissions.query());

  const edit = (item: Submission) => {
    setDraft({ category: item.category, description: item.description, downloadUrl: item.downloadUrl ?? '',
      license: item.license, name: item.name, officialWebsiteUrl: item.officialWebsiteUrl ?? '',
      pricingType: item.pricingType ?? '', productUrl: item.productUrl ?? '', purchaseUrl: item.purchaseUrl ?? '',
      runUrl: item.runUrl ?? '', section: item.section, shape: item.shape, summary: item.summary,
      vendorName: item.vendorName ?? '', visibility: item.visibility });
    setEditing({ id: item.id, version: item.version });
    setView('draft'); setFailure('');
  };
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setFailure('');
    try {
      const optional = (value: string) => value.trim() || undefined;
      const result = await lambdaClient.engineeringTools.saveMyDraft.mutate({
        category: draft.category.trim(), description: draft.description.trim(),
        downloadUrl: optional(draft.downloadUrl), expectedVersion: editing?.version, id: editing?.id,
        license: draft.license.trim(), name: draft.name.trim(), officialWebsiteUrl: optional(draft.officialWebsiteUrl),
        pricingType: optional(draft.pricingType), productUrl: optional(draft.productUrl),
        purchaseUrl: optional(draft.purchaseUrl), runUrl: optional(draft.runUrl), section: draft.section,
        shape: draft.shape, summary: draft.summary.trim(), vendorName: optional(draft.vendorName),
        visibility: draft.visibility,
      });
      setEditing({ id: result.id, version: result.version });
      await mine.mutate();
      setView('mine');
    } catch (error) { setFailure(workspaceError(error)); await mine.mutate(); }
    finally { setBusy(false); }
  };
  const submit = async (item: Submission) => {
    if (!ready || busy) return;
    setBusy(true); setFailure('');
    try { await lambdaClient.engineeringTools.submitMyDraft.mutate({ id: item.id, expectedVersion: item.version }); await mine.mutate(); }
    catch (error) { setFailure(workspaceError(error)); await mine.mutate(); }
    finally { setBusy(false); }
  };
  const startRevision = async (item: Submission) => {
    if (!ready || busy) return;
    setBusy(true); setFailure('');
    try {
      const result = await lambdaClient.engineeringTools.startRevision.mutate({ id: item.id, expectedVersion: item.version });
      edit({ ...item, id: result.id, version: result.version });
      await mine.mutate();
    } catch (error) { setFailure(workspaceError(error)); await mine.mutate(); }
    finally { setBusy(false); }
  };
  const field = (label: string, key: keyof Draft, required = false, type = 'text') => <label className={styles.field} key={key}>
    <span>{label}</span><Input required={required} type={type} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
  </label>;

  return <section aria-label="工具社区" className={styles.body}>
    <h2>工具社区</h2>
    <div style={{ minWidth: 0, overflowX: 'auto' }}><Tabs activeKey={view} items={[
      { key: 'draft', label: '提交工具' }, { key: 'mine', label: '我的投稿' }, { key: 'review', label: '审核管理' },
    ]} onChange={(key) => setView(key as typeof view)} /></div>
    {!ready && <p role="status">工作区加载中，暂不可提交。</p>}
    {failure && <p role="alert">{failure}</p>}
    {view === 'draft' && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={styles.editor}>
        {field('工具名称', 'name', true)}
        {field('分类', 'category', true)}
        <label className={styles.field}><span>专业领域</span><Select options={sections} value={draft.section} onChange={(value) => setDraft((current) => ({ ...current, section: value as Draft['section'] }))} /></label>
        <label className={styles.field}><span>运行形态</span><Select options={shapes} value={draft.shape} onChange={(value) => setDraft((current) => ({ ...current, shape: value as Draft['shape'] }))} /></label>
        <label className={styles.field}><span>可见范围</span><Select disabled={!!editing} options={[{ label: '公开目录', value: 'public' }, ...(workspaceId ? [{ label: '当前工作区', value: 'workspace' }] : [])]} value={draft.visibility} onChange={(value) => setDraft((current) => ({ ...current, visibility: value as Draft['visibility'] }))} /></label>
        {field('维护组织 / 厂商', 'vendorName')}
        {field('许可说明', 'license', true)}
        {field('收费方式', 'pricingType')}
        <label className={`${styles.field} ${styles.full}`}><span>摘要</span><textarea maxLength={1200} rows={2} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
        <label className={`${styles.field} ${styles.full}`}><span>工具介绍</span><textarea required maxLength={4000} rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        {field('官方网址', 'officialWebsiteUrl', false, 'url')}
        {field('产品介绍链接', 'productUrl', false, 'url')}
        {field('运行链接（仅作投稿资料，不自动授权）', 'runUrl', false, 'url')}
        {field('下载链接', 'downloadUrl', false, 'url')}
        {field('购买链接', 'purchaseUrl', false, 'url')}
      </div>
      <div className={styles.toolbar}>
        <Button disabled={!ready || busy} htmlType="submit">{editing ? '保存修改' : '保存草稿'}</Button>
        <Button htmlType="button" onClick={() => { setDraft(blank); setEditing(undefined); setFailure(''); }}>新建草稿</Button>
      </div>
    </form>}
    {view === 'mine' && <>
      {mine.error && <p role="alert">投稿读取失败</p>}
      {!mine.isLoading && !mine.data?.length && <p>暂无投稿</p>}
      {mine.data?.map((item) => <div className={styles.row} key={item.id}>
        <strong>{item.name}</strong><span>{statuses[item.status]}</span><span>{item.visibility === 'workspace' ? '当前工作区' : '公开'}</span>
        {item.status === 'rejected' && <span role="status">退回原因：{item.reviewReason}</span>}
        {(item.status === 'draft' || item.status === 'rejected') && <Button onClick={() => edit(item)}>编辑</Button>}
        {item.status === 'draft' && <Button disabled={busy || !ready} onClick={() => void submit(item)}>提交审核</Button>}
        {item.status === 'published' && <Button disabled={busy || !ready} onClick={() => void startRevision(item)}>发起修订</Button>}
      </div>)}
    </>}
    {view === 'review' && <SubmissionReviewPanel onCatalogChange={onCatalogChange} />}
  </section>;
};

export default CommunityPanel;
