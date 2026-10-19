import { z } from 'zod';

export const moduleAppWorkflowRoutePayloadSchema = z.object({
  installationId: z.string().uuid(),
  runId: z.string().uuid(),
});

type ModuleAppWorkflowRoutePayload = z.infer<typeof moduleAppWorkflowRoutePayloadSchema>;

export const createModuleAppWorkflowRouteHandler =
  (dependencies: {
    enabled: boolean | (() => boolean | Promise<boolean>);
    execute: (payload: ModuleAppWorkflowRoutePayload) => Promise<unknown>;
    verify: (request: Request, rawBody: string) => Promise<boolean>;
  }) =>
  async (request: Request) => {
    const rawBody = await request.text();
    if (!(await dependencies.verify(request, rawBody))) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const enabled =
      typeof dependencies.enabled === 'function'
        ? await dependencies.enabled()
        : dependencies.enabled;
    if (!enabled) {
      return Response.json(
        { error: 'module_app_workflow_privileged_executors_disabled' },
        { status: 503 },
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const payload = moduleAppWorkflowRoutePayloadSchema.safeParse(json);
    if (!payload.success) return Response.json({ error: 'invalid_payload' }, { status: 400 });

    return Response.json({ run: await dependencies.execute(payload.data) });
  };
