import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { moduleAppService } from '@/services/moduleApp';

const TERMINAL_STATUSES = new Set(['cancelled', 'failed', 'succeeded']);

const styles = createStaticStyles(({ css, cssVar }) => ({
  progress: css`
    width: 100%;
    height: 8px;
    accent-color: ${cssVar.colorPrimary};
  `,
  root: css`
    position: absolute;
    z-index: 10;
    right: 16px;
    bottom: 16px;
    width: min(360px, calc(100% - 32px));
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

type WorkflowNode = { nodeKey: string; status: string };
type WorkflowRun = { status: string };

interface WorkflowProgressViewProps {
  cancelFailed?: boolean;
  cancelling?: boolean;
  nodes: WorkflowNode[];
  onCancel: () => void;
  run: WorkflowRun;
}

export const WorkflowProgressView = memo<WorkflowProgressViewProps>(
  ({ cancelFailed, cancelling, nodes, onCancel, run }) => {
    const { t } = useTranslation('common');
    const completed = nodes.filter((node) =>
      ['skipped', 'succeeded'].includes(node.status),
    ).length;
    const terminal = TERMINAL_STATUSES.has(run.status);

    return (
      <Flexbox className={styles.root} gap={8} role={'status'}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={600}>
            {t(`moduleApps.workflow.status.${run.status}`, { defaultValue: run.status })}
          </Text>
          <Text type={'secondary'}>{`${completed} / ${nodes.length}`}</Text>
        </Flexbox>
        <progress
          aria-label={t('moduleApps.workflow.progress')}
          aria-valuemax={Math.max(nodes.length, 1)}
          aria-valuemin={0}
          aria-valuenow={completed}
          className={styles.progress}
          max={Math.max(nodes.length, 1)}
          value={completed}
        />
        {!terminal && (
          <Button
            disabled={cancelling}
            icon={<X size={16} />}
            size={'small'}
            onClick={onCancel}
          >
            {t('cancel')}
          </Button>
        )}
        {cancelFailed && (
          <Text role={'alert'} type={'danger'}>
            {t('moduleApps.runtime.failure.description')}
          </Text>
        )}
      </Flexbox>
    );
  },
);

WorkflowProgressView.displayName = 'WorkflowProgressView';

interface WorkflowProgressProps {
  installationId: string;
  runId: string;
  workspaceId?: string;
}

const WorkflowProgress = memo<WorkflowProgressProps>(({ installationId, runId, workspaceId }) => {
  const [cancelFailed, setCancelFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const input = { installationId, runId, workspaceId };
  const state = useSWR(
    ['moduleApp.workflowProgress', installationId, runId, workspaceId],
    async () => {
      const [run, nodes] = await Promise.all([
        moduleAppService.getWorkflowRun(input),
        moduleAppService.listWorkflowNodes(input),
      ]);
      return { nodes: nodes as WorkflowNode[], run: run as WorkflowRun };
    },
    {
      refreshInterval: (data) => (data && TERMINAL_STATUSES.has(data.run.status) ? 0 : 2000),
      revalidateOnFocus: true,
    },
  );

  if (!state.data || state.error) return null;

  const cancelRun = async () => {
    if (cancelling) return;
    setCancelFailed(false);
    setCancelling(true);
    try {
      await moduleAppService.cancelWorkflowRun(input);
      await state.mutate();
    } catch {
      setCancelFailed(true);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <WorkflowProgressView
      cancelFailed={cancelFailed}
      cancelling={cancelling}
      nodes={state.data.nodes}
      run={state.data.run}
      onCancel={() => void cancelRun()}
    />
  );
});

WorkflowProgress.displayName = 'WorkflowProgress';

export default WorkflowProgress;
