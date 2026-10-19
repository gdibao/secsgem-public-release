import type { ModuleAppPage } from '@lobechat/types';

type ModuleAppPageKey = Pick<ModuleAppPage, 'key'>;

export const getInitialModuleAppPageKey = (pages: ModuleAppPageKey[]) =>
  pages.find((page) => page.key === 'overview')?.key ?? pages[0]?.key ?? 'overview';

export const resolveModuleAppPagePath = (appId: string, pageKey: string) =>
  `/apps/${appId}/app/${pageKey}`;

export const formatModuleAppRunPreview = (run: { preview?: string; status: string }) => {
  if (run.preview?.trim()) return run.preview.trim();
  if (run.status === 'failed') return 'Run failed';
  if (run.status === 'denied') return 'Run denied';
  if (run.status === 'succeeded') return 'Run succeeded';
  return 'Run pending';
};
