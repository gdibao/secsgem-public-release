import { z } from 'zod';

import { moduleAppTableSchema } from './moduleAppData';
import { moduleAppWorkflowDefinitionSchema } from './moduleAppWorkflow';

const moduleAppPackagePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !value.includes('\\') &&
      !value.split('/').some((segment) => !segment || segment === '..'),
    'module_app_package_path_invalid',
  );

export const moduleAppRuntimeLanguageSchema = z.enum(['node22', 'python312']);
export type ModuleAppRuntimeLanguage = z.infer<typeof moduleAppRuntimeLanguageSchema>;

export const MODULE_APP_RUNTIME_READINESS_CHALLENGE_HEADER = 'x-comhub-module-runtime-challenge';
export const MODULE_APP_RUNTIME_READINESS_PROOF_HEADER = 'x-comhub-module-runtime-proof';
export const MODULE_APP_RUNTIME_READINESS_PROOF_CONTEXT = 'comhub-module-runtime-readiness:v1';

export const moduleAppRuntimeReadinessCodeSchema = z.enum([
  'MODULE_APP_RUNTIME_ARTIFACT_ROOT_UNAVAILABLE',
  'MODULE_APP_RUNTIME_AUTH_FAILED',
  'MODULE_APP_RUNTIME_CONFIG_MISSING',
  'MODULE_APP_RUNTIME_DOCKER_HOST_INVALID',
  'MODULE_APP_RUNTIME_DOCKER_ROOTLESS_REQUIRED',
  'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
  'MODULE_APP_RUNTIME_PROBE_INVALID',
  'MODULE_APP_RUNTIME_PROBE_TIMEOUT',
  'MODULE_APP_RUNTIME_UNAVAILABLE',
  'MODULE_APP_RUNTIME_UNREACHABLE',
]);
export type ModuleAppRuntimeReadinessCode = z.infer<typeof moduleAppRuntimeReadinessCodeSchema>;

export const moduleAppRuntimeReadinessSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled') }).strict(),
  z.object({ status: z.literal('ready') }).strict(),
  z
    .object({
      code: moduleAppRuntimeReadinessCodeSchema,
      status: z.literal('unavailable'),
    })
    .strict(),
]);
export type ModuleAppRuntimeReadiness = z.infer<typeof moduleAppRuntimeReadinessSchema>;

export const moduleAppBuildProfileSchema = z.enum(['node22-static', 'python312-assets']);
export type ModuleAppBuildProfile = z.infer<typeof moduleAppBuildProfileSchema>;

export const moduleAppBuildStatusSchema = z.enum(['queued', 'building', 'ready', 'failed']);
export type ModuleAppBuildStatus = z.infer<typeof moduleAppBuildStatusSchema>;

export const moduleAppBuildConfigSchema = z
  .object({
    frontend: z
      .object({
        output: moduleAppPackagePathSchema,
        profile: moduleAppBuildProfileSchema,
      })
      .strict(),
  })
  .strict();
export type ModuleAppBuildConfig = z.infer<typeof moduleAppBuildConfigSchema>;

export const normalizeModuleAppOutboundHost = (value: string) => {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) throw new Error('module_app_outbound_host_invalid');

  let parsed: URL;
  try {
    parsed = new URL(`https://${host}`);
  } catch {
    throw new Error('module_app_outbound_host_invalid');
  }
  const normalized = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    normalized !== host ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('module_app_outbound_host_invalid');
  }

  return normalized;
};

export const moduleAppOutboundHostSchema = z.string().transform((value, context) => {
  try {
    return normalizeModuleAppOutboundHost(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'module_app_outbound_host_invalid' });
    return z.NEVER;
  }
});

export const moduleAppOutboundHostsSchema = z
  .array(moduleAppOutboundHostSchema)
  .max(80)
  .superRefine((hosts, context) => {
    const seen = new Set<string>();
    hosts.forEach((host, index) => {
      if (seen.has(host)) {
        context.addIssue({
          code: 'custom',
          message: 'module_app_outbound_host_duplicate',
          path: [index],
        });
      }
      seen.add(host);
    });
  });

export const moduleAppOutboundHostPurposeSchema = z.enum(['general', 'ai', 'payment']);
export type ModuleAppOutboundHostPurpose = z.infer<typeof moduleAppOutboundHostPurposeSchema>;

export const moduleAppOutboundHostPolicySchema = z
  .object({
    host: moduleAppOutboundHostSchema,
    purpose: moduleAppOutboundHostPurposeSchema,
  })
  .strict();
export type ModuleAppOutboundHostPolicy = z.infer<typeof moduleAppOutboundHostPolicySchema>;

export const moduleAppOutboundHostPoliciesSchema = z
  .array(moduleAppOutboundHostPolicySchema)
  .max(80)
  .superRefine((policies, context) => {
    const seen = new Set<string>();
    policies.forEach(({ host }, index) => {
      if (seen.has(host)) {
        context.addIssue({
          code: 'custom',
          message: 'module_app_outbound_host_duplicate',
          path: [index, 'host'],
        });
      }
      seen.add(host);
    });
  });

export const assertModuleAppOutboundHostPolicyCoverage = (
  declaredHosts: string[],
  policies: ModuleAppOutboundHostPolicy[],
) => {
  const declared = moduleAppOutboundHostsSchema.parse(declaredHosts);
  const reviewed = moduleAppOutboundHostPoliciesSchema.parse(policies);
  const byHost = new Map(reviewed.map((policy) => [policy.host, policy]));
  if (declared.length !== reviewed.length || declared.some((host) => !byHost.has(host))) {
    throw new Error('MODULE_APP_OUTBOUND_HOST_CLASSIFICATION_REQUIRED');
  }

  return declared.map((host) => byHost.get(host)!);
};

export const getModuleAppGeneralOutboundHosts = (runtimeManifest: unknown) => {
  if (!runtimeManifest || typeof runtimeManifest !== 'object') return [];
  const manifest = runtimeManifest as Record<string, unknown>;
  if (!('outboundHostPolicies' in manifest)) return [];
  const runtime =
    manifest.runtime && typeof manifest.runtime === 'object'
      ? (manifest.runtime as Record<string, unknown>)
      : {};
  const declared = moduleAppOutboundHostsSchema.safeParse(runtime.outboundHosts ?? []);
  const reviewed = moduleAppOutboundHostPoliciesSchema.safeParse(manifest.outboundHostPolicies);
  if (!declared.success || !reviewed.success) {
    throw new Error('MODULE_APP_OUTBOUND_HOST_POLICIES_INVALID');
  }

  return assertModuleAppOutboundHostPolicyCoverage(declared.data, reviewed.data)
    .filter(({ purpose }) => purpose === 'general')
    .map(({ host }) => host);
};

export const moduleAppRuntimeFunctionSchema = z
  .object({
    entry: moduleAppPackagePathSchema,
    key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    runtime: moduleAppRuntimeLanguageSchema,
  })
  .strict();

export const moduleAppExecutableRuntimeSchema = z
  .object({
    data: z
      .object({ tables: z.array(moduleAppTableSchema).max(50) })
      .strict()
      .optional(),
    functions: z.array(moduleAppRuntimeFunctionSchema).max(80).default([]),
    kind: z.literal('sandboxed_app').default('sandboxed_app'),
    outboundHosts: moduleAppOutboundHostsSchema.default([]),
    permissions: z
      .array(z.string().regex(/^[a-z][a-z0-9_.:-]{1,79}$/))
      .max(80)
      .default([]),
    workflows: z.array(moduleAppWorkflowDefinitionSchema).max(50).optional(),
  })
  .strict();
export type ModuleAppExecutableRuntime = z.infer<typeof moduleAppExecutableRuntimeSchema>;

export const moduleAppCapabilityClaimsSchema = z
  .object({
    appId: z.string().uuid(),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    aud: z.literal('module-runtime'),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    installationId: z.string().uuid(),
    nonce: z.string().min(16).max(128),
    permissions: z.array(z.string()).max(80),
    surface: z.enum(['browser', 'runtime']).default('browser'),
    userId: z.string().min(1),
    versionId: z.string().uuid(),
    workspaceId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((claims, ctx) => {
    if (claims.exp <= claims.iat || claims.exp - claims.iat > 300) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'module_app_capability_ttl_invalid' });
    }
    if (claims.surface === 'runtime' && !claims.artifactSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'module_app_runtime_artifact_required',
        path: ['artifactSha256'],
      });
    }
  });
export type ModuleAppCapabilityClaims = z.infer<typeof moduleAppCapabilityClaimsSchema>;

export const moduleAppLaunchContextSchema = z
  .object({
    capability: z.string().min(1),
    displayName: z.string().min(1).max(120),
    expiresAt: z.string().datetime(),
    iframeUrl: z.string().url(),
    installationId: z.string().uuid(),
    nonce: z.string().min(16).max(128),
    runtimeOrigin: z.string().url(),
  })
  .strict();
export type ModuleAppLaunchContext = z.infer<typeof moduleAppLaunchContextSchema>;

export const moduleAppInvocationSchema = z
  .object({
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    capability: z.string().min(1),
    entry: moduleAppPackagePathSchema,
    input: z.unknown(),
    invocationId: z.string().uuid(),
    runtime: moduleAppRuntimeLanguageSchema,
    timeoutMs: z.number().int().min(100).max(60_000),
  })
  .strict();
export type ModuleAppInvocation = z.infer<typeof moduleAppInvocationSchema>;
