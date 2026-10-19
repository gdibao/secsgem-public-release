'use client';

import { Button, Select } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';
import { workspaceError } from './workspaceTypes';

const RatingControl = ({ toolId }: { toolId: string }) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { ready } = useEngineeringWorkspaceScope();
  const key = userId && ready ? [userId, workspaceId ?? 'global', toolId] : null;
  const summary = useSWR(key && ['engineering-rating-summary', ...key], () => lambdaClient.engineeringTools.getRatingSummary.query({ toolId }));
  const mine = useSWR(key && ['engineering-rating-mine', ...key], () => lambdaClient.engineeringTools.getMyRating.query({ toolId }));
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const selected = score ?? mine.data?.score ?? 0;
  const update = async (remove: boolean) => {
    if (!ready || !userId) return;
    setBusy(true); setFailure('');
    try {
      if (remove) {
        if (!mine.data?.score) return;
        await lambdaClient.engineeringTools.removeMyRating.mutate({ expectedVersion: mine.data.version, toolId });
      } else {
        if (!selected) return;
        await lambdaClient.engineeringTools.upsertMyRating.mutate({ expectedVersion: mine.data?.version ?? 0, score: selected, toolId });
      }
      setScore(null);
      await Promise.all([mine.mutate(), summary.mutate()]);
    } catch (error) { setFailure(workspaceError(error)); await mine.mutate(); }
    finally { setBusy(false); }
  };
  return <section aria-label="工具评分">
    <h3>用户评分</h3>
    <p>{summary.data?.count ? `${summary.data.average?.toFixed(1)} / 5 · ${summary.data.count} 人` : '暂无评分'}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <label htmlFor="engineering-my-rating">我的评分</label>
      <Select disabled={!ready || busy || mine.isLoading} id="engineering-my-rating" options={[1, 2, 3, 4, 5].map((value) => ({ label: `${value} 星`, value }))} placeholder="选择评分" value={selected || undefined} onChange={(value) => setScore(Number(value))} />
      <Button disabled={!ready || busy || !selected || mine.isLoading} onClick={() => void update(false)}>{mine.data?.score ? '修改评分' : '提交评分'}</Button>
      {!!mine.data?.score && <Button disabled={!ready || busy} onClick={() => void update(true)}>撤销评分</Button>}
    </div>
    {(failure || summary.error || mine.error) && <p role="alert">{failure || '评分读取失败，请刷新重试'}</p>}
  </section>;
};

export default RatingControl;
