import { appEnv } from '@/envs/app';
import { workflowClient } from '@/libs/qstash';

export type ModuleAppWorkflowJobPayload = {
  installationId: string;
  runId: string;
};

const getRunUrl = () => {
  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
  if (!baseUrl) throw new Error('INTERNAL_APP_URL or APP_URL is required for module app workflows');
  return new URL('/api/workflows/module-app/run', baseUrl).toString();
};

export class ModuleAppWorkflowDispatch {
  static triggerRun(
    payload: ModuleAppWorkflowJobPayload,
    options?: { delayMs?: number; workflowRunId?: string },
  ) {
    return workflowClient.trigger({
      body: payload,
      ...(options?.delayMs ? { delay: Math.max(1, Math.ceil(options.delayMs / 1000)) } : {}),
      flowControl: {
        key: `module-app.run.${payload.installationId}`,
        parallelism: 1,
      },
      url: getRunUrl(),
      ...(options?.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    });
  }
}
