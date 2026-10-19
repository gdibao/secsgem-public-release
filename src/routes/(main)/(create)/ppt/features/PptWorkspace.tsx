'use client';

import { type CSSProperties, memo, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import useSWR from 'swr';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useIsMobile } from '@/hooks/useIsMobile';
import { DocmeeIframeAdapter, type DocmeeIframeOptions } from '@/libs/ppt/docmeeIframe';
import { docmeeService } from '@/services/docmee';

import PptErrorState from './PptErrorState';
import { useDocmeeToken } from './useDocmeeToken';

const getDownloadButton = (runtime: any): DocmeeIframeOptions['downloadButton'] => {
  const formats = [
    runtime?.allowPptxDownload ? ('pptx' as const) : null,
    runtime?.allowPdfExport ? ('pdf' as const) : null,
  ].filter((format): format is 'pdf' | 'pptx' => format !== null);

  return formats.length > 0 ? formats : false;
};

const getUpstreamTaskId = (data: any) =>
  data?.id || data?.taskId || data?.pptId || data?.pptInfo?.id;

const getDocmeeErrorCode = (error: any) =>
  error?.code ||
  error?.data?.code ||
  error?.data?.message ||
  error?.message ||
  'PPT_UPSTREAM_TOKEN_FAILED';

const workspaceContainerStyle = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  width: '100%',
} satisfies CSSProperties;

const workspaceStateStyle = {
  ...workspaceContainerStyle,
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'center',
} satisfies CSSProperties;

const PptWorkspace = memo(() => {
  const { search } = useLocation();
  const isMobile = useIsMobile();
  const recordId = new URLSearchParams(search).get('recordId')?.trim() || undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<DocmeeIframeAdapter | null>(null);
  const [errorCode, setErrorCode] = useState<string>();
  const [retryNonce, setRetryNonce] = useState(0);
  const {
    data: runtime,
    error: runtimeError,
    isLoading,
    mutate,
  } = useSWR(['docmee-ppt-runtime'], () => docmeeService.getPptRuntime());
  const { trigger: createToken } = useDocmeeToken(recordId);

  useEffect(() => {
    if (!runtime || runtime.enabled === false || !runtime.baseUrl || !containerRef.current) return;

    let disposed = false;
    let mountTimeout: number | undefined;

    const mount = async () => {
      try {
        setErrorCode(undefined);
        const token = await createToken();
        if (disposed || !containerRef.current || !token?.token) return;
        const pptId = token.upstreamTaskId;
        let mounted = false;

        const ui = new DocmeeIframeAdapter({
          baseUrl: runtime.baseUrl,
          container: containerRef.current,
          creatorVersion: runtime.creatorVersion,
          downloadButton: getDownloadButton(runtime),
          isMobile,
          lang: runtime.lang,
          mode: 'light',
          onMessage: async (event: any) => {
            if (['error', 'invalid-token', 'mounted'].includes(event.type)) {
              mounted = true;
              if (mountTimeout) window.clearTimeout(mountTimeout);

              if (!disposed && event.type === 'invalid-token') {
                setErrorCode('PPT_UPSTREAM_TOKEN_FAILED');
              }
              if (!disposed && event.type === 'error') {
                setErrorCode(getDocmeeErrorCode(event));
              }
            }

            if (!token?.sessionId) return;
            if (
              ['afterGenerate', 'beforeDownload', 'charge', 'error', 'pageChange'].includes(
                event.type,
              )
            ) {
              await docmeeService.reportPptEvent({
                data: event.data,
                sessionId: token.sessionId,
                type: event.type,
                upstreamTaskId: getUpstreamTaskId(event.data),
              });
            }
          },
          page: pptId ? 'editor' : runtime.creatorVersion === 'v2' ? 'creator-v2' : 'creator',
          ...(pptId ? { pptId } : {}),
          token: token.token,
        });
        uiRef.current = ui;

        if (!mounted) {
          mountTimeout = window.setTimeout(() => {
            if (!disposed && !mounted) setErrorCode('PPT_UPSTREAM_TOKEN_FAILED');
          }, 15_000);
        }
      } catch (error: any) {
        if (!disposed) setErrorCode(getDocmeeErrorCode(error));
      }
    };

    mount();

    return () => {
      disposed = true;
      if (mountTimeout) window.clearTimeout(mountTimeout);
      uiRef.current?.destroy();
      uiRef.current = null;
    };
  }, [createToken, isMobile, recordId, runtime, retryNonce]);

  const handleRetry = () => {
    setErrorCode(undefined);
    setRetryNonce((value) => value + 1);
    mutate();
  };

  const renderError = (code?: string) => (
    <div data-testid="ppt-workspace-error" style={workspaceStateStyle}>
      <PptErrorState code={code} onRetry={handleRetry} />
    </div>
  );

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        data-testid="ppt-workspace-loading"
        role="status"
        style={workspaceStateStyle}
      >
        <NeuralNetworkLoading size={48} />
      </div>
    );
  }
  if (runtimeError) {
    return renderError(getDocmeeErrorCode(runtimeError));
  }
  if ((runtime as any)?.enabled === false) {
    return renderError((runtime as any)?.code);
  }
  if (errorCode) return renderError(errorCode);

  return (
    <div data-testid="ppt-workspace-container" ref={containerRef} style={workspaceContainerStyle} />
  );
});

PptWorkspace.displayName = 'PptWorkspace';

export default PptWorkspace;
