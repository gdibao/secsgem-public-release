const ROOT = 'admin-module-apps' as const;

export const moduleAppCacheKeys = {
  apps: (filters: string, cursor?: string) => [ROOT, 'apps', filters, cursor ?? ''] as const,
  artifacts: (appId: string, cursor?: string) => [ROOT, 'artifacts', appId, cursor ?? ''] as const,
  audit: (appId: string, cursor?: string) => [ROOT, 'audit', appId, cursor ?? ''] as const,
  detail: (appId: string) => [ROOT, 'detail', appId] as const,
  installs: (appId: string, cursor?: string) => [ROOT, 'installs', appId, cursor ?? ''] as const,
  packages: (status: string, cursor?: string) => [ROOT, 'packages', status, cursor ?? ''] as const,
  payments: (filters: string, cursor?: string) =>
    [ROOT, 'payments', filters, cursor ?? ''] as const,
  payouts: (status: string, cursor?: string) => [ROOT, 'payouts', status, cursor ?? ''] as const,
  products: (appId: string) => [ROOT, 'products', appId] as const,
  publishers: (status: string, cursor?: string) =>
    [ROOT, 'publishers', status, cursor ?? ''] as const,
  records: (appId: string, cursor?: string) => [ROOT, 'records', appId, cursor ?? ''] as const,
  revenue: (filters: string, cursor?: string) => [ROOT, 'revenue', filters, cursor ?? ''] as const,
  runtime: (domain: 'artifacts' | 'installs' | 'records' | 'runs', appId: string, limit: number) =>
    [ROOT, 'runtime', domain, appId, limit] as const,
  runtimeDiagnostics: () => [ROOT, 'runtime', 'diagnostics'] as const,
  runs: (appId: string, cursor?: string) => [ROOT, 'runs', appId, cursor ?? ''] as const,
};
