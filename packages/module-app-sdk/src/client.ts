import {
  isModuleAppBridgeEvent,
  isModuleAppBridgeLaunch,
  isModuleAppBridgeResponse,
  MODULE_APP_BRIDGE_CHANNEL,
  type ModuleAppBridgeLaunch,
  type ModuleAppBridgeRequest,
} from './bridge.js';
import type {
  ModuleAppAiChatInput,
  ModuleAppAiChatResult,
  ModuleAppAiModel,
  ModuleAppDataArchiveInput,
  ModuleAppDataGetInput,
  ModuleAppDataInsertInput,
  ModuleAppDataQueryInput,
  ModuleAppDataRow,
  ModuleAppDataTransaction,
  ModuleAppDataUpdateInput,
  ModuleAppPaymentCatalogItem,
  ModuleAppPaymentCheckoutInput,
  ModuleAppPaymentCheckoutResult,
  ModuleAppPaymentMethod,
  ModuleAppPaymentOrderStatusResult,
  ModuleAppTaskRun,
  ModuleAppTaskRunInput,
} from './types.js';

type ModuleAppSdkEvent = 'navigation' | 'progress';
type ModuleAppSdkListener = (payload: unknown) => void;

type MessageEventTarget = {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
};

type MessageTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

type ModuleAppSdkOptions = {
  eventTarget?: MessageEventTarget;
  nonce: string;
  parentWindow?: MessageTarget;
  randomId?: () => string;
  requestTimeoutMs?: number;
  runtimeOrigin: string;
};

type ModuleAppLaunchOptions = {
  eventTarget?: MessageEventTarget;
  nonce: string;
  parentWindow?: MessageTarget;
  timeoutMs?: number;
};

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class ModuleAppSdkError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'ModuleAppSdkError';
  }
}

export interface ModuleAppSdk {
  ai: {
    chat: (input: ModuleAppAiChatInput) => Promise<ModuleAppAiChatResult>;
    listModels: () => Promise<ModuleAppAiModel[]>;
  };
  context: <T extends Record<string, unknown> = Record<string, unknown>>() => Promise<T>;
  data: {
    archive: (input: ModuleAppDataArchiveInput) => Promise<ModuleAppDataRow>;
    get: (input: ModuleAppDataGetInput) => Promise<ModuleAppDataRow | null>;
    insert: (input: ModuleAppDataInsertInput) => Promise<ModuleAppDataRow>;
    list: (input: ModuleAppDataQueryInput) => Promise<{
      items: ModuleAppDataRow[];
      nextCursor: null | string;
    }>;
    transaction: (input: ModuleAppDataTransaction) => Promise<ModuleAppDataRow[]>;
    update: (input: ModuleAppDataUpdateInput) => Promise<ModuleAppDataRow>;
  };
  dispose: () => void;
  invoke: <T = unknown>(method: string, input?: unknown) => Promise<T>;
  on: (event: ModuleAppSdkEvent, listener: ModuleAppSdkListener) => () => void;
  payments: {
    createCheckout: (
      input: ModuleAppPaymentCheckoutInput,
    ) => Promise<ModuleAppPaymentCheckoutResult>;
    getOrderStatus: (input: { orderId: string }) => Promise<ModuleAppPaymentOrderStatusResult>;
    listCatalog: () => Promise<ModuleAppPaymentCatalogItem[]>;
    listMethods: () => Promise<ModuleAppPaymentMethod[]>;
  };
  tasks: {
    cancel: (input: ModuleAppTaskRunInput) => Promise<ModuleAppTaskRun>;
    getRun: (input: ModuleAppTaskRunInput) => Promise<ModuleAppTaskRun | null>;
  };
}

export const waitForModuleAppLaunch = (
  options: ModuleAppLaunchOptions,
): Promise<ModuleAppBridgeLaunch> => {
  if (options.nonce.length < 16) {
    return Promise.reject(new ModuleAppSdkError('MODULE_APP_SDK_NONCE_INVALID'));
  }

  const eventTarget: MessageEventTarget =
    options.eventTarget ?? (window as unknown as MessageEventTarget);
  const parentWindow: MessageTarget =
    options.parentWindow ?? (window.parent as unknown as MessageTarget);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      eventTarget.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== parentWindow ||
        !isModuleAppBridgeLaunch(event.data) ||
        event.data.nonce !== options.nonce
      ) {
        return;
      }

      let hostOrigin: string;
      try {
        hostOrigin = new URL(event.data.hostOrigin).origin;
      } catch {
        return;
      }
      if (event.origin !== hostOrigin) return;

      cleanup();
      resolve(event.data);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new ModuleAppSdkError('MODULE_APP_SDK_LAUNCH_TIMEOUT'));
    }, options.timeoutMs ?? 30_000);

    eventTarget.addEventListener('message', onMessage);
    parentWindow.postMessage(
      { channel: MODULE_APP_BRIDGE_CHANNEL, nonce: options.nonce, type: 'ready' },
      '*',
    );
  });
};

export const createModuleAppSdk = (options: ModuleAppSdkOptions): ModuleAppSdk => {
  if (options.nonce.length < 16) throw new ModuleAppSdkError('MODULE_APP_SDK_NONCE_INVALID');

  const runtimeOrigin = new URL(options.runtimeOrigin).origin;
  const eventTarget: MessageEventTarget =
    options.eventTarget ?? (window as unknown as MessageEventTarget);
  const parentWindow: MessageTarget =
    options.parentWindow ?? (window.parent as unknown as MessageTarget);
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const pending = new Map<string, PendingRequest>();
  const listeners = new Map<ModuleAppSdkEvent, Set<ModuleAppSdkListener>>();
  let disposed = false;

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.origin !== runtimeOrigin || event.source !== parentWindow) {
      return;
    }

    if (isModuleAppBridgeResponse(event.data) && event.data.nonce === options.nonce) {
      const request = pending.get(event.data.id);
      if (!request) return;

      clearTimeout(request.timeout);
      pending.delete(event.data.id);
      if (event.data.ok) {
        request.resolve(event.data.result);
      } else {
        request.reject(
          new ModuleAppSdkError(
            event.data.error?.code ?? 'MODULE_APP_SDK_REQUEST_FAILED',
            event.data.error?.message,
          ),
        );
      }
      return;
    }

    if (isModuleAppBridgeEvent(event.data) && event.data.nonce === options.nonce) {
      for (const listener of listeners.get(event.data.event) ?? []) listener(event.data.payload);
    }
  };

  eventTarget.addEventListener('message', onMessage);

  const invoke = <T = unknown>(method: string, input?: unknown): Promise<T> => {
    if (disposed) return Promise.reject(new ModuleAppSdkError('MODULE_APP_SDK_DISPOSED'));
    if (!method || method.length > 120) {
      return Promise.reject(new ModuleAppSdkError('MODULE_APP_SDK_METHOD_INVALID'));
    }

    const id = randomId();
    const message: ModuleAppBridgeRequest = {
      channel: MODULE_APP_BRIDGE_CHANNEL,
      id,
      input,
      method,
      nonce: options.nonce,
      type: 'request',
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new ModuleAppSdkError('MODULE_APP_SDK_TIMEOUT'));
      }, requestTimeoutMs);
      pending.set(id, {
        reject,
        resolve: resolve as (value: unknown) => void,
        timeout,
      });
      parentWindow.postMessage(message, runtimeOrigin);
    });
  };

  return {
    ai: {
      chat: (input) => invoke<ModuleAppAiChatResult>('ai.chat', input),
      listModels: () => invoke<ModuleAppAiModel[]>('ai.models.list'),
    },
    context: <T extends Record<string, unknown> = Record<string, unknown>>() =>
      invoke<T>('context.get'),
    data: {
      archive: (input) => invoke<ModuleAppDataRow>('data.archive', input),
      get: (input) => invoke<ModuleAppDataRow | null>('data.get', input),
      insert: (input) => invoke<ModuleAppDataRow>('data.insert', input),
      list: (input) =>
        invoke<{ items: ModuleAppDataRow[]; nextCursor: null | string }>('data.list', input),
      transaction: (input) => invoke<ModuleAppDataRow[]>('data.transaction', input),
      update: (input) => invoke<ModuleAppDataRow>('data.update', input),
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      eventTarget.removeEventListener('message', onMessage);
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new ModuleAppSdkError('MODULE_APP_SDK_DISPOSED'));
      }
      pending.clear();
      listeners.clear();
    },
    invoke,
    on: (event, listener) => {
      const eventListeners = listeners.get(event) ?? new Set<ModuleAppSdkListener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);

      return () => eventListeners.delete(listener);
    },
    payments: {
      createCheckout: (input) =>
        invoke<ModuleAppPaymentCheckoutResult>('payments.checkout.create', input),
      getOrderStatus: (input) =>
        invoke<ModuleAppPaymentOrderStatusResult>('payments.status.get', input),
      listCatalog: () => invoke<ModuleAppPaymentCatalogItem[]>('payments.catalog.list'),
      listMethods: () => invoke<ModuleAppPaymentMethod[]>('payments.methods.list'),
    },
    tasks: {
      cancel: (input) => invoke<ModuleAppTaskRun>('tasks.cancel', input),
      getRun: (input) => invoke<ModuleAppTaskRun | null>('tasks.getRun', input),
    },
  };
};
