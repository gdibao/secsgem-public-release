import type { ModuleAppLaunchContext, ModuleAppScopeType } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Clock3, RefreshCw, ServerOff, ShieldAlert, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import useSWR from 'swr';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { moduleAppService } from '@/services/moduleApp';

import type { ModuleAppRuntimeManifest } from './PageRenderer';
import PageRenderer from './PageRenderer';
import RecentRunResult from './RecentRunResult';
import WorkflowProgress from './WorkflowProgress';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    position: relative;

    width: 100%;
    height: 100%;
    min-height: 480px;

    background: ${cssVar.colorBgLayout};
  `,
  state: css`
    width: min(480px, calc(100% - 32px));
    margin: auto;
    text-align: center;
  `,
}));

type RuntimeState = 'buildNotReady' | 'denied' | 'failure' | 'unavailable';

const runtimeStateMeta = {
  buildNotReady: { icon: Clock3, key: 'buildNotReady' },
  denied: { icon: ShieldAlert, key: 'denied' },
  failure: { icon: TriangleAlert, key: 'failure' },
  unavailable: { icon: ServerOff, key: 'unavailable' },
} as const;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return '';
};

export const resolveModuleAppRuntimeState = (error: unknown): RuntimeState => {
  const message = getErrorMessage(error);
  if (message.includes('module_app_build_not_ready')) return 'buildNotReady';
  if (message.includes('module_app_runtime_unavailable')) return 'unavailable';
  if (
    message.includes('module_app_installation_required') ||
    message.includes('module_app_workspace_denied') ||
    message.includes('plan_run_denied')
  ) {
    return 'denied';
  }
  return 'failure';
};

interface ModuleAppRuntimeViewProps {
  appId?: string;
  context?: ModuleAppLaunchContext;
  error?: unknown;
  initialScopeType?: ModuleAppScopeType;
  loading: boolean;
  manifest?: ModuleAppRuntimeManifest | null;
  onRetry: () => void;
  pageKey?: string;
  recordId?: string;
  runId?: string;
  workspaceId?: string;
}

export const ModuleAppRuntimeView = memo<ModuleAppRuntimeViewProps>(
  ({
    appId,
    context,
    error,
    initialScopeType,
    loading,
    manifest,
    onRetry,
    pageKey,
    recordId,
    runId,
    workspaceId,
  }) => {
    const { t } = useTranslation('common');

    if (loading) {
      return (
        <Flexbox
          align={'center'}
          aria-busy={'true'}
          className={styles.root}
          justify={'center'}
          role={'status'}
        >
          <NeuralNetworkLoading size={48} />
        </Flexbox>
      );
    }

    if (error || !context) {
      const state = resolveModuleAppRuntimeState(error);
      const meta = runtimeStateMeta[state];
      return (
        <Flexbox align={'center'} className={styles.root} justify={'center'}>
          <Flexbox align={'center'} className={styles.state} gap={12}>
            <Icon icon={meta.icon} size={32} />
            <Text as={'h2'} style={{ fontSize: 18, margin: 0 }} weight={600}>
              {t(`moduleApps.runtime.${meta.key}.title`)}
            </Text>
            <Text type={'secondary'}>{t(`moduleApps.runtime.${meta.key}.description`)}</Text>
            <Button icon={<RefreshCw size={16} />} onClick={onRetry}>
              {t('moduleApps.runtime.retry')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <div className={styles.root} data-testid="module-app-runtime">
        <PageRenderer
          appId={appId}
          context={context}
          initialScopeType={initialScopeType}
          manifest={manifest}
          pageKey={pageKey}
          recordId={recordId}
          workspaceId={workspaceId}
        />
        <RecentRunResult installationId={context.installationId} workspaceId={workspaceId} />
        {runId && (
          <WorkflowProgress
            installationId={context.installationId}
            runId={runId}
            workspaceId={workspaceId}
          />
        )}
      </div>
    );
  },
);

ModuleAppRuntimeView.displayName = 'ModuleAppRuntimeView';

const ModuleAppRuntime = memo(() => {
  const { appId, pageKey } = useParams();
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId') || undefined;
  const runId = searchParams.get('runId') || undefined;
  const recordId = searchParams.get('recordId') || undefined;
  const requestedScopeType = searchParams.get('scopeType');
  const initialScopeType: ModuleAppScopeType | undefined =
    requestedScopeType === 'personal' ||
    (requestedScopeType === 'workspace' && Boolean(workspaceId))
      ? requestedScopeType
      : undefined;
  const launch = useSWR<ModuleAppLaunchContext>(
    appId ? ['moduleApp.getLaunchContext', appId, workspaceId] : null,
    () => moduleAppService.getLaunchContext({ appId: appId!, workspaceId }),
    { refreshInterval: 240_000, revalidateOnFocus: true },
  );
  const manifest = useSWR<ModuleAppRuntimeManifest | null>(
    appId ? ['moduleApp.getRuntimeManifest', appId, workspaceId] : null,
    () =>
      moduleAppService.getRuntimeManifest({
        appId: appId!,
        workspaceId,
      }) as Promise<ModuleAppRuntimeManifest | null>,
  );

  return (
    <ModuleAppRuntimeView
      appId={appId}
      context={launch.data}
      initialScopeType={initialScopeType}
      loading={Boolean(appId && (launch.isLoading || (pageKey && manifest.isLoading)))}
      manifest={manifest.data}
      pageKey={pageKey}
      recordId={recordId}
      runId={runId}
      workspaceId={workspaceId}
      error={
        appId
          ? (launch.error ?? (pageKey ? manifest.error : undefined))
          : new Error('module_app_installation_required')
      }
      onRetry={() => void Promise.all([launch.mutate(), manifest.mutate()])}
    />
  );
});

ModuleAppRuntime.displayName = 'ModuleAppRuntime';

export default ModuleAppRuntime;
