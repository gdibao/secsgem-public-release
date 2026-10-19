import { type MobileBuiltinAppV1, normalizeMobileBuiltinApps } from '@/const/mobileConfig';
import type { AvailableModuleApp } from '@/services/moduleApp';

export type MobileInstalledModuleApp = AvailableModuleApp;

export type MobileModuleApp = MobileInstalledModuleApp & {
  routePath: string;
};

export const buildMobileBuiltinApps = (items: MobileBuiltinAppV1[]) =>
  normalizeMobileBuiltinApps(items).filter((item) => item.enabled);

export const buildMobileModuleApps = (
  items: MobileInstalledModuleApp[],
  featuredModuleAppIds: string[],
): MobileModuleApp[] => {
  const featuredOrder = new Map(featuredModuleAppIds.map((id, index) => [id, index]));

  return items
    .filter(
      (item) => item.installed && item.status === 'published' && item.planState.runnable === true,
    )
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftFeatured = featuredOrder.get(left.item.id);
      const rightFeatured = featuredOrder.get(right.item.id);

      if (leftFeatured !== undefined && rightFeatured !== undefined) {
        return leftFeatured - rightFeatured;
      }
      if (leftFeatured !== undefined) return -1;
      if (rightFeatured !== undefined) return 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ item }) => ({
      ...item,
      routePath:
        item.installationScope === 'workspace' && item.workspaceId
          ? `/apps/${encodeURIComponent(item.id)}/app?workspaceId=${encodeURIComponent(item.workspaceId)}&scopeType=workspace`
          : `/apps/${encodeURIComponent(item.id)}/app`,
    }));
};
