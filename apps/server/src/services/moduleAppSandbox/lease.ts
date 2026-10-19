import { recordModuleAppSandboxReplayRejection } from '@lobechat/observability-otel/modules/module-app';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { ModuleAppInvocationLeaseStore } from './contracts';

type ModuleAppLeaseRedis = {
  eval: (script: string, numberOfKeys: number, ...args: string[]) => Promise<unknown>;
  set: (
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ) => Promise<null | string>;
};

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const leaseKey = (invocationId: string) =>
  `module-app:invocation-lease:${invocationId}`;

const assertLeaseInput = (input: { invocationId: string; ownerId: string }) => {
  if (!input.invocationId.trim() || !input.ownerId.trim()) {
    throw new Error('MODULE_APP_INVOCATION_LEASE_INPUT_INVALID');
  }
};

export class RedisModuleAppInvocationLeaseStore implements ModuleAppInvocationLeaseStore {
  constructor(
    private readonly redis: ModuleAppLeaseRedis | null =
      getAgentRuntimeRedisClient() as ModuleAppLeaseRedis | null,
    private readonly metrics: { recordReplayRejection: () => void } = {
      recordReplayRejection: recordModuleAppSandboxReplayRejection,
    },
  ) {}

  acquire = async (input: { invocationId: string; ownerId: string; ttlMs: number }) => {
    assertLeaseInput(input);
    if (!Number.isInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new Error('MODULE_APP_INVOCATION_LEASE_TTL_INVALID');
    }
    if (!this.redis) throw new Error('MODULE_APP_SHARED_STATE_REQUIRED');

    const result = await this.redis.set(
      leaseKey(input.invocationId),
      input.ownerId,
      'PX',
      input.ttlMs,
      'NX',
    );
    if (result !== 'OK') this.metrics.recordReplayRejection();
    return result === 'OK';
  };

  release = async (input: { invocationId: string; ownerId: string }) => {
    assertLeaseInput(input);
    if (!this.redis) throw new Error('MODULE_APP_SHARED_STATE_REQUIRED');

    await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      leaseKey(input.invocationId),
      input.ownerId,
    );
  };
}
