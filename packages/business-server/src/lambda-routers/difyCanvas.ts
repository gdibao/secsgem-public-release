import { PERMISSION_ACTIONS } from '@lobechat/const/rbac';
import { serverDB } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { RbacModel } from '@/database/models/rbac';
import { UserModel } from '@/database/models/user';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { ADMIN_CAPABILITIES, adminAnyCapabilityProcedure, router } from '@/libs/trpc/lambda';

const httpsOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  });

const canvasConfig = z
  .object({
    healthUrl: z.string().url(),
    studioOrigin: httpsOrigin,
    workspaces: z.array(
      z.object({
        difyWorkspaceId: z.string().min(1),
        fabWorkspaceId: z.string().min(1),
        workflows: z.array(
          z.object({
            appId: z.string().min(1),
            name: z.string().min(1),
            publishedPath: z.string().startsWith('/').optional(),
            studioPath: z.string().startsWith('/'),
          }),
        ),
      }),
    ),
  })
  .superRefine(({ workspaces }, context) => {
    const fabWorkspaceIds = new Set<string>();
    const difyWorkspaceIds = new Set<string>();
    const appIds = new Set<string>();

    workspaces.forEach((workspace, workspaceIndex) => {
      if (fabWorkspaceIds.has(workspace.fabWorkspaceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fab workspace mapping must be unique',
          path: ['workspaces', workspaceIndex, 'fabWorkspaceId'],
        });
      }
      fabWorkspaceIds.add(workspace.fabWorkspaceId);

      if (difyWorkspaceIds.has(workspace.difyWorkspaceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Dify workspace mapping must be tenant-unique',
          path: ['workspaces', workspaceIndex, 'difyWorkspaceId'],
        });
      }
      difyWorkspaceIds.add(workspace.difyWorkspaceId);

      workspace.workflows.forEach((workflow, workflowIndex) => {
        if (appIds.has(workflow.appId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A Dify app may be mapped to one Fab workspace only',
            path: ['workspaces', workspaceIndex, 'workflows', workflowIndex, 'appId'],
          });
        }
        appIds.add(workflow.appId);
      });
    });
  });

type CanvasConfig = z.infer<typeof canvasConfig>;

const readCanvasConfig = (): CanvasConfig | null => {
  const value = process.env.DIFY_CANVAS_CONFIG_JSON;
  if (!value) return null;
  try {
    return canvasConfig.parse(JSON.parse(value));
  } catch {
    return null;
  }
};

const workflowInputsSchema = z
  .record(z.string(), z.unknown())
  .default({})
  .superRefine((inputs, context) => {
    if (Buffer.byteLength(JSON.stringify(inputs), 'utf8') > 32 * 1024) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Workflow inputs are too large' });
    }
  });

const inputFieldTypes = ['text-input', 'paragraph', 'number', 'select', 'checkbox', 'json_object'] as const;
type WorkflowInputField = {
  defaultValue?: boolean | number | Record<string, unknown> | string;
  label: string;
  maxLength?: number;
  options?: string[];
  required: boolean;
  type: (typeof inputFieldTypes)[number];
  variable: string;
};

const parseWorkflowInputFields = (value: unknown): WorkflowInputField[] | null => {
  if (!value || typeof value !== 'object' || !('user_input_form' in value)) return null;
  const form = value.user_input_form;
  if (!Array.isArray(form)) return null;

  const fields: WorkflowInputField[] = [];
  const variables = new Set<string>();
  for (const item of form) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const [type] = Object.keys(item);
    if (Object.keys(item).length !== 1 || !inputFieldTypes.includes(type as (typeof inputFieldTypes)[number])) {
      return null;
    }
    const spec = (item as Record<string, unknown>)[type];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const field = spec as Record<string, unknown>;
    if (typeof field.variable !== 'string' || !field.variable || typeof field.label !== 'string') return null;
    if (variables.has(field.variable)) return null;
    variables.add(field.variable);
    if (field.required !== undefined && typeof field.required !== 'boolean') return null;
    if (field.max_length !== undefined && field.max_length !== null && typeof field.max_length !== 'number') {
      return null;
    }
    const options = field.options;
    if (type === 'select' && (!Array.isArray(options) || !options.every((option) => typeof option === 'string'))) {
      return null;
    }
    const defaultValue = field.default;
    let parsedDefaultValue: WorkflowInputField['defaultValue'];
    if (defaultValue !== undefined) {
      const isJsonObject =
        type === 'json_object' &&
        typeof defaultValue === 'object' &&
        defaultValue !== null &&
        !Array.isArray(defaultValue);
      const isPrimitive =
        typeof defaultValue === 'string' ||
        typeof defaultValue === 'number' ||
        typeof defaultValue === 'boolean';
      if (!isJsonObject && !isPrimitive) return null;
      parsedDefaultValue = isJsonObject
        ? (defaultValue as Record<string, unknown>)
        : (defaultValue as string | number | boolean);
    }
    fields.push({
      ...(parsedDefaultValue === undefined ? {} : { defaultValue: parsedDefaultValue }),
      label: field.label,
      ...(typeof field.max_length === 'number' ? { maxLength: field.max_length } : {}),
      ...(type === 'select' ? { options: options as string[] } : {}),
      required: field.required === true,
      type: type as WorkflowInputField['type'],
      variable: field.variable,
    });
  }
  return fields;
};

const readServiceApiOrigin = (): string | null => {
  const value = process.env.DIFY_SERVICE_API_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const readWorkflowApiKey = (appId: string): string | null => {
  const value = process.env.DIFY_WORKFLOW_API_KEYS_JSON;
  if (!value) return null;
  try {
    const keys: unknown = JSON.parse(value);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null;
    const key = Object.hasOwn(keys, appId) ? (keys as Record<string, unknown>)[appId] : null;
    return typeof key === 'string' && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
};

const fetchWorkflowInputFields = async (
  apiOrigin: string,
  apiKey: string,
  userId: string,
): Promise<WorkflowInputField[]> => {
  const url = new URL('/v1/parameters', apiOrigin);
  url.searchParams.set('user', `fab:${userId}`);
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey}` },
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Dify parameters unavailable');
  const fields = parseWorkflowInputFields(await response.json());
  if (!fields) throw new Error('Dify parameters invalid or unsupported');
  return fields;
};

const validateWorkflowInputs = (fields: WorkflowInputField[], inputs: Record<string, unknown>) => {
  const fieldByName = new Map(fields.map((field) => [field.variable, field]));
  for (const key of Object.keys(inputs)) {
    if (!fieldByName.has(key)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown workflow input' });
  }
  for (const field of fields) {
    const value = inputs[field.variable];
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Required workflow input is missing' });
      continue;
    }
    const valid =
      (field.type === 'text-input' || field.type === 'paragraph') &&
      typeof value === 'string' &&
      (!field.maxLength || value.length <= field.maxLength)
        ? true
        : field.type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : field.type === 'select'
            ? typeof value === 'string' && field.options?.includes(value)
            : field.type === 'checkbox'
              ? typeof value === 'boolean'
              : field.type === 'json_object'
                ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
                : false;
    if (!valid) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Workflow input has an invalid type' });
  }
};

const assertCanRunWorkflow = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
) => {
  const user = await UserModel.findById(db, userId);
  if (!user || user.banned) throw new TRPCError({ code: 'FORBIDDEN' });

  const rbac = new RbacModel(db, userId);
  const permitted = await rbac.hasPermission(`${PERMISSION_ACTIONS.AI_MODEL_INVOKE}:all`, {
    workspaceId,
  });
  if (!permitted) throw new TRPCError({ code: 'FORBIDDEN' });
};

const getWorkspace = (config: CanvasConfig, workspaceId: string) =>
  config.workspaces.find((item) => item.fabWorkspaceId === workspaceId) ?? null;

const isStudioHealthy = async (healthUrl: string) => {
  try {
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const mappedUrl = (origin: string, path: string): string | null => {
  const url = new URL(path, origin);
  return url.origin === new URL(origin).origin && !url.username && !url.password
    ? url.toString()
    : null;
};

const adminWorkspaceProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.systemWrite,
  ADMIN_CAPABILITIES.moduleAppWrite,
]).use(requireWorkspaceRole('viewer'));
const adminGlobalProcedure = adminAnyCapabilityProcedure([
  ADMIN_CAPABILITIES.systemWrite,
  ADMIN_CAPABILITIES.moduleAppWrite,
]);

export const difyCanvasRouter = router({
  // Platform administrators need a discoverable Studio entry even when they
  // are in personal scope and are not members of a mapped Fab workspace.
  adminEntry: adminGlobalProcedure.query(async () => {
    const config = readCanvasConfig();
    if (!config || !(await isStudioHealthy(config.healthUrl))) return { available: false };
    return { available: true, url: config.studioOrigin };
  }),

  // Ordinary users receive mapped workflow metadata, never a Dify URL or token.
  list: wsProcedure.query(async ({ ctx }) => {
    const config = readCanvasConfig();
    const workspace = config && getWorkspace(config, ctx.workspaceId);
    if (!config || !workspace) {
      return { available: false, workflows: [] as { appId: string; name: string }[] };
    }
    const db = (ctx as typeof ctx & { serverDB?: typeof serverDB }).serverDB ?? serverDB;
    if (!ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' });
    await assertCanRunWorkflow(db as LobeChatDatabase, ctx.userId, ctx.workspaceId);
    if (!(await isStudioHealthy(config.healthUrl))) {
      return { available: false, workflows: [] as { appId: string; name: string }[] };
    }

    return {
      available: true,
      workflows: workspace.workflows.flatMap(({ appId, name, publishedPath }) =>
        publishedPath ? [{ appId, name }] : [],
      ),
    };
  }),

  parameters: wsProcedure
    .input(z.object({ appId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const config = readCanvasConfig();
      const workspaceId = ctx.workspaceId;
      const userId = ctx.userId;
      const db = ((ctx as typeof ctx & { serverDB?: typeof serverDB }).serverDB ?? serverDB) as LobeChatDatabase;
      const workflow = config && workspaceId
        ? getWorkspace(config, workspaceId)?.workflows.find(
            ({ appId, publishedPath }) => appId === input.appId && Boolean(publishedPath),
          )
        : undefined;
      if (!config || !workspaceId || !userId || !workflow) throw new TRPCError({ code: 'FORBIDDEN' });
      await assertCanRunWorkflow(db, userId, workspaceId);
      const apiOrigin = readServiceApiOrigin();
      const apiKey = readWorkflowApiKey(workflow.appId);
      if (!apiOrigin || !apiKey) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
      if (!(await isStudioHealthy(config.healthUrl))) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
      try {
        return { appId: workflow.appId, fields: await fetchWorkflowInputFields(apiOrigin, apiKey, userId) };
      } catch {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify workflow parameters are unavailable' });
      }
    }),

  // This capability endpoint drives admin navigation and Studio commands. It is
  // also workspace-scoped; a global admin role does not bypass tenant mapping.
  adminList: adminWorkspaceProcedure.query(async ({ ctx }) => {
    const config = readCanvasConfig();
    if (!config || !ctx.workspaceId) {
      return { available: false, workflows: [] as { appId: string; name: string }[] };
    }
    const workspace = getWorkspace(config, ctx.workspaceId);
    if (!workspace) {
      return { available: false, workflows: [] as { appId: string; name: string }[] };
    }
    if (!ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' });
    if (!(await isStudioHealthy(config.healthUrl))) {
      return { available: false, workflows: [] as { appId: string; name: string }[] };
    }
    return {
      available: true,
      workflows: workspace.workflows.map(({ appId, name }) => ({ appId, name })),
    };
  }),

  openStudio: adminWorkspaceProcedure
    .input(z.object({ appId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const config = readCanvasConfig();
      if (!config || !ctx.workspaceId) throw new TRPCError({ code: 'FORBIDDEN' });
      const workspace = getWorkspace(config, ctx.workspaceId);
      const workflow = workspace?.workflows.find((item) => item.appId === input.appId);
      if (!workflow) throw new TRPCError({ code: 'FORBIDDEN' });
      if (!(await isStudioHealthy(config.healthUrl))) {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify Studio is unavailable' });
      }
      const url = mappedUrl(config.studioOrigin, workflow.studioPath);
      if (!url) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
      return { url };
    }),

  run: wsProcedure
    .input(
      z.object({
        appId: z.string().min(1),
        inputs: workflowInputsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const config = readCanvasConfig();
      const workspaceId = ctx.workspaceId;
      const userId = ctx.userId;
      const db = ((ctx as typeof ctx & { serverDB?: typeof serverDB }).serverDB ?? serverDB) as LobeChatDatabase;
      if (!config || !workspaceId || !userId) throw new TRPCError({ code: 'FORBIDDEN' });

      const workspace = getWorkspace(config, workspaceId);
      const workflow = workspace?.workflows.find(({ appId }) => appId === input.appId);
      if (!workspace || !workflow?.publishedPath) throw new TRPCError({ code: 'FORBIDDEN' });

      await assertCanRunWorkflow(db, userId, workspaceId);
      const apiOrigin = readServiceApiOrigin();
      const apiKey = readWorkflowApiKey(workflow.appId);
      if (!apiOrigin || !apiKey) {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify workflow service is not configured' });
      }
      if (!(await isStudioHealthy(config.healthUrl))) {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify workflow service is unavailable' });
      }
      let fields: WorkflowInputField[];
      try {
        fields = await fetchWorkflowInputFields(apiOrigin, apiKey, userId);
      } catch {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify workflow parameters are unavailable' });
      }
      validateWorkflowInputs(fields, input.inputs);

      const audit = new WorkspaceAuditLogModel(db);
      const auditEvent = (
        outcome: string,
        details: { httpStatus?: number; status?: string; workflowRunId?: string } = {},
      ) =>
        audit.create({
          action: 'dify.workflow.run',
          metadata: { appId: workflow.appId, outcome, ...details },
          resourceId: workflow.appId,
          resourceType: 'dify.workflow',
          userId,
          workspaceId,
        });
      const recordAudit = async (
        outcome: string,
        details: { httpStatus?: number; status?: string; workflowRunId?: string } = {},
      ) => {
        try {
          await auditEvent(outcome, details);
        } catch {
          throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Workflow audit is unavailable' });
        }
      };
      await recordAudit('requested');

      let response: Response;
      try {
        response = await fetch(`${apiOrigin}/v1/workflows/run`, {
          body: JSON.stringify({
            inputs: input.inputs,
            response_mode: 'blocking',
            user: `fab:${userId}`,
          }),
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        await recordAudit('upstream_unavailable');
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Dify workflow service is unavailable' });
      }

      if (!response.ok) {
        await recordAudit('upstream_rejected', { httpStatus: response.status });
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Dify workflow request failed' });
      }

      let result: unknown;
      try {
        result = await response.json();
      } catch {
        await recordAudit('invalid_response');
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Dify workflow response was invalid' });
      }
      const data =
        result && typeof result === 'object' && 'data' in result &&
        result.data && typeof result.data === 'object'
          ? result.data
          : undefined;
      const outputs = data && 'outputs' in data ? data.outputs : undefined;
      const workflowRunId =
        data && 'id' in data && typeof data.id === 'string'
          ? data.id
          : result && typeof result === 'object' && 'workflow_run_id' in result &&
              typeof result.workflow_run_id === 'string'
            ? result.workflow_run_id
            : undefined;
      const status = data && 'status' in data && typeof data.status === 'string' ? data.status : undefined;
      if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
        await recordAudit('invalid_response', { status, workflowRunId });
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Dify workflow response was invalid' });
      }
      if (!workflowRunId || !status) {
        await recordAudit('invalid_response', { status, workflowRunId });
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Dify workflow response was invalid' });
      }
      if (status !== 'succeeded') {
        await recordAudit('workflow_failed', { status, workflowRunId });
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Dify workflow did not succeed' });
      }

      let auditRecorded = true;
      try {
        await auditEvent('completed', { status, workflowRunId });
      } catch {
        auditRecorded = false;
      }
      return { auditRecorded, outputs, status };
    }),
});
