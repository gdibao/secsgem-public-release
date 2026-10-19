import { describe, expect, it } from 'vitest';

import {
  isModuleAppBridgeReady,
  isModuleAppBridgeRequest,
  MODULE_APP_BRIDGE_CHANNEL,
} from './bridge';

describe('module app bridge handshake guards', () => {
  it('accepts only channel-bound ready messages with a nonce', () => {
    expect(
      isModuleAppBridgeReady({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        nonce: 'launch-nonce-0001',
        type: 'ready',
      }),
    ).toBe(true);
    expect(
      isModuleAppBridgeReady({ channel: 'other-channel', nonce: 'launch-nonce-0001', type: 'ready' }),
    ).toBe(false);
  });

  it('rejects malformed and unbounded request identities', () => {
    expect(
      isModuleAppBridgeRequest({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'request-1',
        input: {},
        method: 'context.get',
        nonce: 'launch-nonce-0001',
        type: 'request',
      }),
    ).toBe(true);
    expect(
      isModuleAppBridgeRequest({
        channel: MODULE_APP_BRIDGE_CHANNEL,
        id: 'x'.repeat(161),
        method: 'context.get',
        nonce: 'launch-nonce-0001',
        type: 'request',
      }),
    ).toBe(false);
  });
});
