import { createHash } from 'node:crypto';

import { z } from 'zod';

import { publicHttpsUrl, toolIdSchema } from './schema';

const collectionId = z.string().uuid();
const endpointId = z.string().uuid();
const shortText = z.string().trim().min(1).max(120);

const engineeringCollectionObject = z.object({
  entries: z.array(z.object({
    alias: z.string().trim().max(120).nullable(),
    defaultEndpointId: endpointId.nullable(),
    groupId: collectionId.nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    toolId: toolIdSchema,
  })).max(500).refine((entries) =>
    new Set(entries.map((entry) => `${entry.groupId ?? ''}\0${entry.toolId}`)).size === entries.length,
    'The same tool may appear once per group',
  ),
  groups: z.array(z.object({ id: collectionId, name: shortText, sortOrder: z.number().int().min(0).max(100_000) })).max(100),
  id: collectionId,
  name: shortText,
  ownerId: z.string().min(1),
  sortOrder: z.number().int().min(0).max(100_000),
  version: z.number().int().positive(),
  workspaceId: z.string().min(1).nullable(),
});

const validGroups = (value: { entries: { groupId: string | null }[]; groups: { id: string }[] }) =>
  new Set(value.groups.map((group) => group.id)).size === value.groups.length &&
  value.entries.every((entry) => !entry.groupId || value.groups.some((group) => group.id === entry.groupId));

export const engineeringCollectionSchema = engineeringCollectionObject.refine(validGroups);

export const collectionWriteSchema = engineeringCollectionObject.omit({ ownerId: true, version: true, workspaceId: true }).extend({
  expectedVersion: z.number().int().positive().optional(),
  id: collectionId.optional(),
}).refine(validGroups);
export const collectionDeleteSchema = z.object({ expectedVersion: z.number().int().positive(), id: collectionId });

const evidence = z.object({
  checkedAt: z.string().datetime({ offset: true }),
  reference: publicHttpsUrl,
});
const publicHttpsOrigin = publicHttpsUrl.refine((value) => {
  const url = new URL(value);
  return url.pathname === '/' && !url.search && !url.hash;
}, 'An HTTPS origin is required');

export const engineeringEndpointSchema = z.object({
  authPrerequisite: z.string().max(500),
  embedEvidence: z.object({
    browserLoginVerified: z.boolean(),
    cspFrameAncestorsAllowed: z.boolean(),
    permission: evidence,
    xFrameOptionsAllowed: z.boolean(),
  }).nullable(),
  enabled: z.boolean(),
  hostedEvidence: z.object({
    approvedOrigin: publicHttpsOrigin,
    deploymentVerifiedAt: z.string().datetime({ offset: true }),
    rights: evidence,
  }).nullable(),
  id: endpointId,
  licenseEvidence: evidence.nullable(),
  licenseState: z.enum(['pending', 'verified', 'denied']),
  mode: z.enum(['external_web', 'embedded_web', 'hosted_web']),
  title: shortText,
  toolId: toolIdSchema,
  url: publicHttpsUrl,
  version: z.number().int().positive(),
});

export const endpointWriteSchema = engineeringEndpointSchema.omit({ version: true }).extend({
  expectedVersion: z.number().int().positive().optional(),
  id: endpointId.optional(),
});
export const endpointDisableSchema = z.object({ expectedVersion: z.number().int().positive(), id: endpointId });
export const resolveLaunchSchema = z.object({ endpointId: endpointId.optional(), toolId: toolIdSchema });

const panelStateWriteObject = z.object({
  activeTabId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().min(0),
  panelOpen: z.boolean(),
  tabs: z.array(z.object({
    closed: z.boolean(),
    endpointId: endpointId.nullable(),
    id: z.string().uuid(),
    kind: z.enum(['detail', 'runtime']),
    toolId: toolIdSchema,
  })).max(30),
  width: z.number().int().min(300).max(4096).nullable(),
});
const validPanelState = (value: { activeTabId: string | null; tabs: { closed: boolean; id: string }[] }) =>
  new Set(value.tabs.map((tab) => tab.id)).size === value.tabs.length &&
  (!value.activeTabId || value.tabs.some((tab) => tab.id === value.activeTabId && !tab.closed));
// L2-2 (docs/pilot/l2-audit-log-design.md): minimal audit input schema for
// tool open behavior. Zero new table: writes reuse the existing
// admin_audit_logs store via recordAdminAudit (see workspaceRouter).
export const toolAuditWriteObject = z.object({
  action: z.enum(['tool_open.embedded', 'tool_open.external']),
  endpointId: z.string().nullable(),
  toolId: z.string().min(1),
});
export const toolAuditSchema = toolAuditWriteObject;
export const panelStateWriteSchema = panelStateWriteObject.refine(validPanelState,
  'Tabs must be unique and the active tool must be open');

export const panelStateSchema = panelStateWriteObject.omit({ expectedVersion: true }).extend({
  version: z.number().int().positive(),
}).refine(validPanelState, 'Tabs must be unique and the active tool must be open');

export type EngineeringCollection = z.infer<typeof engineeringCollectionSchema>;
export type EngineeringEndpoint = z.infer<typeof engineeringEndpointSchema>;
export type CollectionWrite = z.infer<typeof collectionWriteSchema>;
export type CollectionDelete = z.infer<typeof collectionDeleteSchema>;

export const endpointUnavailableReason = (endpoint: EngineeringEndpoint) => {
  if (!endpoint.enabled) return 'disabled' as const;
  if (endpoint.licenseState === 'denied') return 'license_denied' as const;
  if (endpoint.licenseState !== 'verified') return 'license_pending' as const;
  if (!endpoint.licenseEvidence) return 'license_evidence_missing' as const;
  if (endpoint.mode === 'external_web') return null;
  if (endpoint.mode === 'embedded_web') {
    const frame = endpoint.embedEvidence;
    return frame?.browserLoginVerified && frame.cspFrameAncestorsAllowed && frame.xFrameOptionsAllowed
      ? null : 'embed_unverified' as const;
  }
  // Stored rights and a past deployment timestamp cannot attest current service identity or health.
  return 'hosted_unverified' as const;
};

export const endpointLaunchable = (endpoint: EngineeringEndpoint): boolean =>
  endpointUnavailableReason(endpoint) === null;

export type ToolEndpointSummary = {
  authPrerequisite: string;
  available: boolean;
  id: string | null;
  licenseState: EngineeringEndpoint['licenseState'];
  mode: EngineeringEndpoint['mode'];
  reason: ReturnType<typeof endpointUnavailableReason>;
  revision: string;
  title: string;
};

export const configuredEndpointRevision = (endpoint: EngineeringEndpoint) =>
  `configured:${endpoint.id}:${endpoint.version}`;

export const legacyEndpointRevision = (tool: {
  accessState?: string;
  enabled: boolean;
  id: string;
  launchUrl: string | null;
  shape: string;
}) => `legacy:${createHash('sha256').update(JSON.stringify([
  tool.id, tool.launchUrl, tool.enabled, tool.accessState, tool.shape,
])).digest('hex')}`;
