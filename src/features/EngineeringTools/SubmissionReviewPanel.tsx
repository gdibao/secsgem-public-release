'use client';

import { Button, Input } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';
import { workspaceError } from './workspaceTypes';

interface SubmissionReviewPanelProps { onCatalogChange?: () => void }

const SubmissionReviewPanel = ({ onCatalogChange }: SubmissionReviewPanelProps) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { ready } = useEngineeringWorkspaceScope();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, string[]>>({});
  const [busyId, setBusyId] = useState<string>();
  const [failure, setFailure] = useState('');
  const pending = useSWR(userId && ready ? ['engineering-submissions-review', userId, workspaceId ?? 'global'] : null,
    () => lambdaClient.engineeringTools.adminListPending.query());

  const review = async (item: NonNullable<typeof pending.data>[number], decision: 'publish' | 'reject') => {
    const reason = reasons[item.id]?.trim();
    const reference = references[item.id]?.trim();
    const links = [item.officialWebsiteUrl, item.productUrl, item.runUrl, item.downloadUrl, item.purchaseUrl]
      .filter((url): url is string => !!url);
    const verifiedUrls = verified[item.id] ?? [];
    if (!ready || busyId || !reason || decision === 'publish' && (
      !reference || ![item.officialWebsiteUrl, item.productUrl].some(Boolean) ||
      links.some((url) => !verifiedUrls.includes(url)))) return;
    setBusyId(item.id); setFailure('');
    try {
      await lambdaClient.engineeringTools.adminReview.mutate({ decision, expectedVersion: item.version,
        evidence: decision === 'publish' ? { checkedAt: new Date().toISOString(), reference: reference!, verifiedUrls } : undefined,
        id: item.id, reason });
      await pending.mutate();
      onCatalogChange?.();
      setVerified((current) => ({ ...current, [item.id]: [] }));
    } catch (error) { setFailure(workspaceError(error)); await pending.mutate(); }
    finally { setBusyId(undefined); }
  };

  return <section aria-label="工程工具投稿审核" className={styles.body}>
    <h2>投稿审核</h2>
    {!ready && <p role="status">工作区加载中，暂不可审核。</p>}
    {pending.error && <p role="alert">无审核权限或待审列表读取失败。</p>}
    {failure && <p role="alert">{failure}</p>}
    {pending.isLoading && <p role="status">加载待审投稿</p>}
    {!pending.isLoading && !pending.error && !pending.data?.length && <p>暂无待审投稿</p>}
    {pending.data?.map((item) => {
      const links = [item.officialWebsiteUrl, item.productUrl, item.runUrl, item.downloadUrl, item.purchaseUrl]
        .filter((url): url is string => !!url);
      return <div className={styles.row} key={item.id}>
      <div style={{ flex: '1 1 100%', minWidth: 0 }}>
        <strong>{item.name}</strong>
        <p>{item.description}</p>
        <span>{item.visibility === 'workspace' ? '工作区投稿' : '公开投稿'} · {item.license} · {item.pricingType ?? '收费未说明'}</span>
        {item.officialWebsiteUrl && <p><a href={item.officialWebsiteUrl} rel="noopener noreferrer" target="_blank">投稿的官方网址</a></p>}
        {item.downloadUrl && <p><a href={item.downloadUrl} rel="noopener noreferrer" target="_blank">投稿的下载链接</a></p>}
        {item.runUrl && <p><a href={item.runUrl} rel="noopener noreferrer" target="_blank">投稿的运行链接</a></p>}
      </div>
      <label className={styles.field}><span>{item.name} 审核原因</span><Input maxLength={500} value={reasons[item.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
      <label className={styles.field}><span>{item.name} 发布来源证据链接</span><Input type="url" value={references[item.id] ?? ''} onChange={(event) => setReferences((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
      {links.map((url) => <label key={url} style={{ overflowWrap: 'anywhere' }}>
        <input checked={verified[item.id]?.includes(url) ?? false} type="checkbox" onChange={(event) => setVerified((current) => ({
          ...current, [item.id]: event.target.checked
            ? [...new Set([...(current[item.id] ?? []), url])]
            : (current[item.id] ?? []).filter((value) => value !== url),
        }))} /> 已核验 <a href={url} rel="noopener noreferrer" target="_blank">{url}</a>
      </label>)}
      {!item.officialWebsiteUrl && !item.productUrl && <p role="status">缺少官方网址或产品链接，不能发布。</p>}
      <Button disabled={!!busyId || !reasons[item.id]?.trim() || !references[item.id]?.trim() ||
        ![item.officialWebsiteUrl, item.productUrl].some(Boolean) || links.some((url) => !verified[item.id]?.includes(url))}
      onClick={() => void review(item, 'publish')}>审核通过并发布</Button>
      <Button disabled={!!busyId || !reasons[item.id]?.trim()} onClick={() => void review(item, 'reject')}>退回</Button>
    </div>})}
  </section>;
};

export default SubmissionReviewPanel;
