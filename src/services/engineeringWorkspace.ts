'use client';

import type { CollectionWrite, EndpointWrite } from '@/features/EngineeringTools/workspaceTypes';
import { lambdaClient } from '@/libs/trpc/client';

const api = () => lambdaClient.engineeringTools;

export const engineeringWorkspaceService = {
  listPersonal: () => api().listPersonalCollections.query(),
  savePersonal: (input: CollectionWrite) => api().savePersonalCollection.mutate(input),
  removePersonal: (input: { id: string; expectedVersion: number }) => api().removePersonalCollection.mutate(input),
  listShared: () => api().listWorkspaceCollections.query(),
  saveShared: (input: CollectionWrite) => api().saveWorkspaceCollection.mutate(input),
  removeShared: (input: { id: string; expectedVersion: number }) => api().removeWorkspaceCollection.mutate(input),
  listEndpoints: (toolId: string) => api().listEndpointsForTool.query({ toolId }),
  resolveLaunch: (input: { toolId: string; endpointId?: string }) => api().resolveLaunch.query(input),
  // L2-2 (docs/pilot/l2-audit-log-design.md): tool open behavior audit point.
  // Best-effort from the client side: failures are surfaced to the caller as
  // rejections so LaunchPanel can warn without blocking tool usage.
  recordToolAudit: (input: { action: 'tool_open.embedded' | 'tool_open.external'; endpointId: string | null; toolId: string }) =>
    api().recordToolLaunchAudit.mutate(input),
  adminListEndpoints: () => api().adminListEndpoints.query(),
  adminSaveEndpoint: (input: EndpointWrite) => api().adminSaveEndpoint.mutate(input),
  adminDisableEndpoint: (input: { id: string; expectedVersion: number }) => api().adminDisableEndpoint.mutate(input),
};

export type ToolEndpoint = Awaited<ReturnType<typeof engineeringWorkspaceService.listEndpoints>>[number];
export type LaunchResult = Awaited<ReturnType<typeof engineeringWorkspaceService.resolveLaunch>>;
