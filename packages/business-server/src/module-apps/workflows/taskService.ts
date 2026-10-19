import {
  type ModuleAppCapabilityClaims,
  type ModuleAppTaskRun,
  moduleAppTaskRunInputSchema,
} from '@lobechat/types';

export interface ModuleAppTaskRepository {
  cancelRun: (input: { installationId: string; runId: string }) => Promise<ModuleAppTaskRun>;
  getRun: (input: { installationId: string; runId: string }) => Promise<ModuleAppTaskRun | null>;
}

const parseInput = (input: unknown) => {
  const parsed = moduleAppTaskRunInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('MODULE_APP_TASK_INPUT_INVALID');
  return parsed.data;
};

const assertPermission = (capability: ModuleAppCapabilityClaims, permission: string) => {
  if (!capability.permissions.includes(permission)) throw new Error('MODULE_APP_CAPABILITY_DENIED');
};

export class ModuleAppTaskService {
  constructor(private readonly repository: ModuleAppTaskRepository) {}

  getRun = (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'tasks.read');
    const input = parseInput(params.input);
    return this.repository.getRun({
      installationId: params.capability.installationId,
      runId: input.runId,
    });
  };

  cancel = (params: { capability: ModuleAppCapabilityClaims; input: unknown }) => {
    assertPermission(params.capability, 'tasks.write');
    const input = parseInput(params.input);
    return this.repository.cancelRun({
      installationId: params.capability.installationId,
      runId: input.runId,
    });
  };
}
