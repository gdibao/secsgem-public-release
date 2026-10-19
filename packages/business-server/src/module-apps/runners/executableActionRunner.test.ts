import { describe, expect, it, vi } from 'vitest';

import { runModuleAppExecutableAction } from './executableActionRunner';

describe('runModuleAppExecutableAction', () => {
  const action = {
    id: 'search',
    inputSchema: { fields: [] },
    moduleMultiplier: 1,
    name: 'Search',
    outputSchema: {},
    runtimeConfig: { functionKey: 'search_jobs' },
    runtimeType: 'executable_action' as const,
  };

  it('normalizes a runtime response into a module app runner result', async () => {
    const invoke = vi.fn().mockResolvedValue({
      output: { matches: [{ id: 'job-1' }] },
      stderr: '',
      stdout: '{"matches":[{"id":"job-1"}]}',
    });

    await expect(
      runModuleAppExecutableAction({
        action,
        artifactSha256: 'a'.repeat(64),
        input: { query: 'jobs' },
        invoke,
        invocationId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({
      output: { matches: [{ id: 'job-1' }] },
      preview: '',
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        artifactSha256: 'a'.repeat(64),
        input: { query: 'jobs' },
        invocationId: '00000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it.each([undefined, 'done', ['done']])(
    'rejects malformed runtime output instead of coercing %j into success',
    async (output) => {
      await expect(
        runModuleAppExecutableAction({
          action,
          artifactSha256: 'a'.repeat(64),
          input: {},
          invoke: vi.fn().mockResolvedValue({ output, stdout: 'secret-log' }),
          invocationId: '00000000-0000-4000-8000-000000000001',
        }),
      ).rejects.toThrow('MODULE_APP_RUNTIME_OUTPUT_INVALID');
    },
  );
});
