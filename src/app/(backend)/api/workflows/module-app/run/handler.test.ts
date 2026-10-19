// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createModuleAppWorkflowRouteHandler } from './handler';

const payload = {
  installationId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};

describe('Module App workflow route controls', () => {
  it('rejects disabled privileged executors before running a workflow job', async () => {
    const execute = vi.fn();
    const enabled = vi.fn().mockResolvedValue(false);
    const handler = createModuleAppWorkflowRouteHandler({
      enabled,
      execute,
      verify: vi.fn().mockResolvedValue(true),
    });

    const response = await handler(
      new Request('https://app.example.com/api/workflows/module-app/run', {
        body: JSON.stringify(payload),
        method: 'POST',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'module_app_workflow_privileged_executors_disabled',
    });
    expect(enabled).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('verifies the request before executing a valid enabled payload', async () => {
    const execute = vi.fn().mockResolvedValue({ id: payload.runId, status: 'running' });
    const verify = vi.fn().mockResolvedValue(true);
    const handler = createModuleAppWorkflowRouteHandler({ enabled: true, execute, verify });
    const request = new Request('https://app.example.com/api/workflows/module-app/run', {
      body: JSON.stringify(payload),
      method: 'POST',
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(request, JSON.stringify(payload));
    expect(execute).toHaveBeenCalledWith(payload);
  });
});
