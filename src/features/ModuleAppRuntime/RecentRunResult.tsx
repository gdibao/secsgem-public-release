'use client';

import { Button } from 'antd';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { moduleAppService } from '@/services/moduleApp';

import RunResultPanel from './RunResultPanel';

const TERMINAL_STATUSES = new Set(['cancelled', 'denied', 'failed', 'succeeded']);

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    position: absolute;
    z-index: 9;
    bottom: 16px;
    left: 16px;

    overflow: auto;
    width: min(360px, calc(100% - 32px));
    max-height: min(420px, calc(100% - 32px));
    padding: 12px;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  toolbar: css`
    display: flex;
    justify-content: flex-end;
    margin-block-end: 4px;
  `,
}));

type PersistedRun = {
  billingSnapshot?: unknown;
  id: string;
  outputSnapshot?: unknown;
  status: string;
};

type RunListResult = { items: PersistedRun[]; nextCursor?: null | string };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const getNumber = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const getString = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

export const normalizePersistedModuleAppRun = (item: PersistedRun) => {
  const billing = asRecord(item.billingSnapshot);
  const output = asRecord(item.outputSnapshot);
  const artifactIds = Array.isArray(output?.artifactIds)
    ? output.artifactIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    artifactIds,
    billing: {
      actualAiCredits: getNumber(billing, 'actualAiCredits'),
      chargedCredits: getNumber(billing, 'chargedCredits'),
      externalApiCostCredits: getNumber(billing, 'externalApiCostCredits'),
      fixedServiceFeeCredits: getNumber(billing, 'fixedServiceFeeCredits'),
      multiplier: getNumber(billing, 'multiplier'),
    },
    output: {
      model: getString(output, 'model'),
      provider: getString(output, 'provider'),
    },
    preview: getString(output, 'preview'),
    status: item.status,
  };
};

interface RecentRunResultProps {
  installationId: string;
  workspaceId?: string;
}

const RecentRunResult = memo<RecentRunResultProps>(({ installationId, workspaceId }) => {
  const { t } = useTranslation('common');
  const [dismissedRunId, setDismissedRunId] = useState<string>();
  const runs = useSWR<RunListResult>(
    ['moduleApp.recentRun', installationId, workspaceId],
    () =>
      moduleAppService.listRuns({
        installationId,
        limit: 1,
        workspaceId,
      }) as Promise<RunListResult>,
    {
      refreshInterval: (data) => {
        const status = data?.items[0]?.status;
        return status && !TERMINAL_STATUSES.has(status) ? 2000 : 0;
      },
      revalidateOnFocus: true,
    },
  );
  const latest = runs.data?.items[0];

  if (!latest || runs.error || latest.id === dismissedRunId) return null;

  return (
    <div className={styles.root} data-testid="module-app-recent-run">
      <div className={styles.toolbar}>
        <Button
          aria-label={t('close')}
          icon={<X size={16} />}
          size="small"
          type="text"
          onClick={() => setDismissedRunId(latest.id)}
        />
      </div>
      <RunResultPanel run={normalizePersistedModuleAppRun(latest)} />
    </div>
  );
});

RecentRunResult.displayName = 'RecentRunResult';

export default RecentRunResult;
