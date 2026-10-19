import { lambdaClient } from '@/libs/trpc/client';

export const docmeeService = {
  createPptToken: (recordId?: string) =>
    lambdaClient.docmee.createPptToken.mutate(recordId ? { recordId } : undefined),
  getPptRuntime: () => lambdaClient.docmee.getPptRuntime.query(),
  reportPptEvent: (params: {
    data?: unknown;
    sessionId: string;
    type: 'afterGenerate' | 'beforeDownload' | 'charge' | 'error' | 'pageChange';
    upstreamTaskId?: string;
  }) => lambdaClient.docmee.reportPptEvent.mutate(params),
};
