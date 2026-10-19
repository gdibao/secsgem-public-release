'use client';

import {
  isModuleAppBridgeReady,
  isModuleAppBridgeRequest,
  MODULE_APP_BRIDGE_CHANNEL,
  type ModuleAppBridgeLaunch,
  type ModuleAppBridgeResponse,
} from '@lobechat/module-app-sdk';
import type { ModuleAppLaunchContext } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { moduleAppService } from '@/services/moduleApp';

const styles = createStaticStyles(({ css, cssVar }) => ({
  frame: css`
    width: 100%;
    height: 100%;
    border: 0;
    background: ${cssVar.colorBgLayout};
  `,
  loading: css`
    position: absolute;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    pointer-events: none;
    background: ${cssVar.colorBgLayout};
  `,
  shell: css`
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    min-height: 480px;
  `,
}));

type ModuleAppSdkInvoker = (input: {
  capability: string;
  input?: unknown;
  method: string;
  requestId?: string;
}) => Promise<unknown>;

const toPublicSdkErrorCode = (error: unknown) => {
  if (
    error instanceof Error &&
    /^(?:MODULE_APP_[A-Z0-9_]+|module_app_[a-z0-9_]+|plan_run_denied)$/.test(error.message)
  ) {
    return error.message;
  }

  return 'MODULE_APP_SDK_REQUEST_FAILED';
};

interface SandboxFrameProps {
  context: ModuleAppLaunchContext;
  invoke?: ModuleAppSdkInvoker;
  title: string;
}

const SandboxFrame = memo<SandboxFrameProps>(
  ({ context, invoke = moduleAppService.callSdk, title }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const launchedRef = useRef(false);
    const [ready, setReady] = useState(false);
    const trustedRuntime = useMemo(() => {
      try {
        return new URL(context.iframeUrl).origin === new URL(context.runtimeOrigin).origin;
      } catch {
        return false;
      }
    }, [context.iframeUrl, context.runtimeOrigin]);

    useEffect(() => {
      launchedRef.current = false;
      setReady(false);
      if (!trustedRuntime) return;

      const postToFrame = (message: ModuleAppBridgeLaunch | ModuleAppBridgeResponse) => {
        // Without allow-same-origin the frame has an opaque origin, so source + nonce
        // are the authority boundary and targetOrigin must be a wildcard.
        frameRef.current?.contentWindow?.postMessage(message, '*');
      };
      const onMessage = (event: MessageEvent) => {
        const frameWindow = frameRef.current?.contentWindow;
        if (!frameWindow || event.source !== frameWindow || event.origin !== 'null') return;

        if (isModuleAppBridgeReady(event.data)) {
          if (event.data.nonce !== context.nonce || launchedRef.current) return;
          launchedRef.current = true;
          setReady(true);
          postToFrame({
            capability: context.capability,
            channel: MODULE_APP_BRIDGE_CHANNEL,
            hostOrigin: window.location.origin,
            nonce: context.nonce,
            type: 'launch',
          });
          return;
        }

        if (
          !launchedRef.current ||
          !isModuleAppBridgeRequest(event.data) ||
          event.data.nonce !== context.nonce
        ) {
          return;
        }

        void invoke({
          capability: context.capability,
          input: event.data.input,
          method: event.data.method,
          requestId: event.data.id,
        })
          .then((result) => {
            postToFrame({
              channel: MODULE_APP_BRIDGE_CHANNEL,
              id: event.data.id,
              nonce: context.nonce,
              ok: true,
              result,
              type: 'response',
            });
          })
          .catch((error: unknown) => {
            postToFrame({
              channel: MODULE_APP_BRIDGE_CHANNEL,
              error: {
                code: toPublicSdkErrorCode(error),
              },
              id: event.data.id,
              nonce: context.nonce,
              ok: false,
              type: 'response',
            });
          });
      };

      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }, [context.capability, context.nonce, invoke, trustedRuntime]);

    if (!trustedRuntime) return null;

    return (
      <div className={styles.shell}>
        <iframe
          className={styles.frame}
          ref={frameRef}
          referrerPolicy={'no-referrer'}
          sandbox={'allow-forms allow-scripts allow-downloads'}
          src={context.iframeUrl}
          title={title}
        />
        {!ready && (
          <div aria-busy={'true'} className={styles.loading}>
            <NeuralNetworkLoading size={40} />
          </div>
        )}
      </div>
    );
  },
);

SandboxFrame.displayName = 'SandboxFrame';

export default SandboxFrame;
