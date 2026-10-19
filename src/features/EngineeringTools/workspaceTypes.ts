import type { z } from 'zod';

import type {
  collectionWriteSchema,
  endpointWriteSchema,
  EngineeringCollection,
  EngineeringEndpoint,
} from '@/business/server/engineering-tools/workspaceSchema';

export type { EngineeringCollection, EngineeringEndpoint };
export type CollectionWrite = z.infer<typeof collectionWriteSchema>;
export type EndpointWrite = z.infer<typeof endpointWriteSchema>;
export type CollectionEntry = EngineeringCollection['entries'][number];

export const endpointModeLabels = {
  external_web: '官方应用（新标签）',
  embedded_web: '工作区嵌入',
  hosted_web: '企业托管服务',
} as const;

export const licenseLabels = { pending: '许可待核', verified: '许可已核', denied: '许可未通过' } as const;

export const endpointReasonLabels = {
  disabled: '端点已停用',
  license_denied: '许可未通过',
  license_pending: '许可待核',
  license_evidence_missing: '缺少许可证据',
  embed_unverified: '嵌入许可、响应头或浏览器登录未核准',
  hosted_unverified: '托管权利、部署身份或健康未核准',
} as const;

export const workspaceError = (error: unknown) => {
  const code = (error as { data?: { code?: string } })?.data?.code;
  if (code === 'CONFLICT') return '版本冲突，编辑内容已保留。请取消编辑、刷新后重新编辑。';
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') return '当前身份无权执行此操作，请检查登录和工作区权限。';
  return error instanceof Error ? error.message : '操作失败，请重试。';
};
