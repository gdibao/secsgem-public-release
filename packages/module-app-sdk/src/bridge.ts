export const MODULE_APP_BRIDGE_CHANNEL = 'comhub.module-app-sdk.v1';

export type ModuleAppBridgeRequest = {
  channel: typeof MODULE_APP_BRIDGE_CHANNEL;
  id: string;
  input: unknown;
  method: string;
  nonce: string;
  type: 'request';
};

export type ModuleAppBridgeResponse = {
  channel: typeof MODULE_APP_BRIDGE_CHANNEL;
  error?: { code?: string; message?: string };
  id: string;
  nonce: string;
  ok: boolean;
  result?: unknown;
  type: 'response';
};

export type ModuleAppBridgeEvent = {
  channel: typeof MODULE_APP_BRIDGE_CHANNEL;
  event: 'navigation' | 'progress';
  nonce: string;
  payload: unknown;
  type: 'event';
};

export type ModuleAppBridgeReady = {
  channel: typeof MODULE_APP_BRIDGE_CHANNEL;
  nonce: string;
  type: 'ready';
};

export type ModuleAppBridgeLaunch = {
  capability: string;
  channel: typeof MODULE_APP_BRIDGE_CHANNEL;
  hostOrigin: string;
  nonce: string;
  type: 'launch';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export const isModuleAppBridgeReady = (value: unknown): value is ModuleAppBridgeReady => {
  if (!isRecord(value)) return false;

  return (
    value.channel === MODULE_APP_BRIDGE_CHANNEL &&
    typeof value.nonce === 'string' &&
    value.type === 'ready'
  );
};

export const isModuleAppBridgeRequest = (value: unknown): value is ModuleAppBridgeRequest => {
  if (!isRecord(value)) return false;

  return (
    value.channel === MODULE_APP_BRIDGE_CHANNEL &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 160 &&
    typeof value.method === 'string' &&
    value.method.length > 0 &&
    value.method.length <= 120 &&
    typeof value.nonce === 'string' &&
    value.type === 'request'
  );
};

export const isModuleAppBridgeLaunch = (value: unknown): value is ModuleAppBridgeLaunch => {
  if (!isRecord(value)) return false;

  return (
    value.channel === MODULE_APP_BRIDGE_CHANNEL &&
    typeof value.capability === 'string' &&
    value.capability.length > 0 &&
    typeof value.hostOrigin === 'string' &&
    typeof value.nonce === 'string' &&
    value.type === 'launch'
  );
};

export const isModuleAppBridgeResponse = (value: unknown): value is ModuleAppBridgeResponse => {
  if (!isRecord(value)) return false;

  return (
    value.channel === MODULE_APP_BRIDGE_CHANNEL &&
    typeof value.id === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.ok === 'boolean' &&
    value.type === 'response'
  );
};

export const isModuleAppBridgeEvent = (value: unknown): value is ModuleAppBridgeEvent => {
  if (!isRecord(value)) return false;

  return (
    value.channel === MODULE_APP_BRIDGE_CHANNEL &&
    (value.event === 'navigation' || value.event === 'progress') &&
    typeof value.nonce === 'string' &&
    value.type === 'event'
  );
};
