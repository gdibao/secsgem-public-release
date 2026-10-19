export type ModuleAppSandboxRuntime = 'node22' | 'python312';

export type ModuleAppSandboxPolicy = {
  cpuLimit: number;
  imageDigest: string;
  memoryLimitBytes: number;
  networkMode: 'none';
  pidsLimit: number;
  runtime: ModuleAppSandboxRuntime;
  timeoutMs: number;
};

export interface ModuleAppInvocationLeaseStore {
  acquire: (input: {
    invocationId: string;
    ownerId: string;
    ttlMs: number;
  }) => Promise<boolean>;
  release: (input: { invocationId: string; ownerId: string }) => Promise<void>;
}
