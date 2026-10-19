import { describe, expect, it } from 'vitest';

import {
  ADMIN_BASE_PATH,
  ADMIN_NAV_GROUPS,
  canAccessAdminPath,
  filterAdminNavGroups,
  getAdminDefaultPath,
  getAdminNavGroupsForRole,
  getAdminNavigationContext,
  getAdminOpenKeys,
  getAdminSelectedKey,
  getAdminUnauthorizedFallbackPath,
} from './adminNavigation';

const collectPaths = () =>
  ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.path));

describe('adminNavigation', () => {
  it('filters scoped admin navigation by domain capability', () => {
    const financePaths = getAdminNavGroupsForRole('finance_admin').flatMap((group) =>
      group.items.map((item) => item.path),
    );

    expect(financePaths).toEqual(
      expect.arrayContaining([
        `${ADMIN_BASE_PATH}/subscriptions`,
        `${ADMIN_BASE_PATH}/plans`,
        `${ADMIN_BASE_PATH}/orders`,
        `${ADMIN_BASE_PATH}/credits`,
        `${ADMIN_BASE_PATH}/stats`,
        `${ADMIN_BASE_PATH}/audit`,
        `${ADMIN_BASE_PATH}/modules`,
      ]),
    );
    expect(financePaths).not.toContain(`${ADMIN_BASE_PATH}/users`);
    expect(financePaths).not.toContain(`${ADMIN_BASE_PATH}/providers`);
    expect(financePaths).not.toContain(`${ADMIN_BASE_PATH}/settings`);
  });

  it('resolves safe default pages and rejects cross-domain direct navigation', () => {
    expect(getAdminDefaultPath('finance_admin')).toBe(`${ADMIN_BASE_PATH}/subscriptions`);
    expect(getAdminDefaultPath('support_admin')).toBe(`${ADMIN_BASE_PATH}/users`);
    expect(getAdminDefaultPath('model_ops')).toBe(`${ADMIN_BASE_PATH}/providers`);
    expect(getAdminDefaultPath('module_admin')).toBe(`${ADMIN_BASE_PATH}/modules`);
    expect(getAdminDefaultPath('system_admin')).toBe(`${ADMIN_BASE_PATH}/settings`);
    expect(canAccessAdminPath('finance_admin', `${ADMIN_BASE_PATH}/plans`)).toBe(true);
    expect(canAccessAdminPath('finance_admin', `${ADMIN_BASE_PATH}/settings`)).toBe(false);
    expect(canAccessAdminPath('admin', `${ADMIN_BASE_PATH}/settings`)).toBe(true);
    expect(canAccessAdminPath('user', `${ADMIN_BASE_PATH}/plans`)).toBe(false);
  });

  it.each([
    ['content_admin', `${ADMIN_BASE_PATH}/content-resources`, `${ADMIN_BASE_PATH}/plans`],
    ['finance_admin', `${ADMIN_BASE_PATH}/subscriptions`, `${ADMIN_BASE_PATH}/settings`],
    ['model_ops', `${ADMIN_BASE_PATH}/providers`, `${ADMIN_BASE_PATH}/users`],
    ['module_admin', `${ADMIN_BASE_PATH}/modules`, `${ADMIN_BASE_PATH}/subscriptions`],
    ['support_admin', `${ADMIN_BASE_PATH}/users`, `${ADMIN_BASE_PATH}/providers`],
    ['system_admin', `${ADMIN_BASE_PATH}/settings`, `${ADMIN_BASE_PATH}/credits`],
  ] as const)('keeps %s inside its default domain', (role, allowedPath, deniedPath) => {
    expect(getAdminDefaultPath(role)).toBe(allowedPath);
    expect(canAccessAdminPath(role, allowedPath)).toBe(true);
    expect(canAccessAdminPath(role, deniedPath)).toBe(false);
  });

  it('applies the most-specific Module Center policy to direct navigation', () => {
    expect(canAccessAdminPath('finance_admin', `${ADMIN_BASE_PATH}/modules`)).toBe(true);
    expect(canAccessAdminPath('finance_admin', `${ADMIN_BASE_PATH}/modules/finance/payments`)).toBe(
      true,
    );
    expect(canAccessAdminPath('finance_admin', `${ADMIN_BASE_PATH}/modules/apps`)).toBe(false);
    expect(canAccessAdminPath('content_admin', `${ADMIN_BASE_PATH}/modules`)).toBe(false);
    expect(canAccessAdminPath('module_admin', `${ADMIN_BASE_PATH}/modules/apps`)).toBe(true);
    expect(canAccessAdminPath('module_admin', `${ADMIN_BASE_PATH}/audit`)).toBe(false);
    expect(canAccessAdminPath('module_admin', `${ADMIN_BASE_PATH}/modules/finance/payments`)).toBe(
      false,
    );
  });

  it('returns a safe Module Center fallback for denied deep links', () => {
    expect(
      getAdminUnauthorizedFallbackPath(
        'finance_admin',
        `${ADMIN_BASE_PATH}/modules/apps/app-1/products`,
      ),
    ).toBe(`${ADMIN_BASE_PATH}/modules`);
    expect(
      getAdminUnauthorizedFallbackPath('content_admin', `${ADMIN_BASE_PATH}/modules/apps`),
    ).toBe(`${ADMIN_BASE_PATH}/content-resources`);
  });

  it('organizes admin pages into the planned management modules', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.key)).toEqual([
      'overview',
      'user-access',
      'commercial',
      'ai-platform',
      'module-apps',
      'content-operations',
      'client-integrations',
      'system-security',
    ]);
  });

  it('keeps all visible admin routes reachable without duplicate sidebar paths', () => {
    const paths = collectPaths();

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        ADMIN_BASE_PATH,
        `${ADMIN_BASE_PATH}/users`,
        `${ADMIN_BASE_PATH}/plans`,
        `${ADMIN_BASE_PATH}/orders`,
        `${ADMIN_BASE_PATH}/credits`,
        `${ADMIN_BASE_PATH}/content-operations`,
        `${ADMIN_BASE_PATH}/growth`,
        `${ADMIN_BASE_PATH}/model-policy`,
        `${ADMIN_BASE_PATH}/providers`,
        `${ADMIN_BASE_PATH}/model-billing-matrix`,
        `${ADMIN_BASE_PATH}/ppt`,
        `${ADMIN_BASE_PATH}/modules`,
        `${ADMIN_BASE_PATH}/subscriptions`,
        `${ADMIN_BASE_PATH}/redemption`,
        `${ADMIN_BASE_PATH}/settings`,
        `${ADMIN_BASE_PATH}/stats`,
        `${ADMIN_BASE_PATH}/content-resources`,
        `${ADMIN_BASE_PATH}/file-storage`,
        `${ADMIN_BASE_PATH}/ai-runtime-defaults`,
        `${ADMIN_BASE_PATH}/user-defaults`,
        `${ADMIN_BASE_PATH}/integrations`,
        `${ADMIN_BASE_PATH}/maintenance`,
        `${ADMIN_BASE_PATH}/audit`,
        `${ADMIN_BASE_PATH}/desktop-update`,
        `${ADMIN_BASE_PATH}/mobile`,
      ]),
    );
  });

  it('labels model pricing and policy tasks as part of the model center', () => {
    const modelApiItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'ai-platform')?.items ?? [];

    expect(
      modelApiItems.find((item) => item.path === `${ADMIN_BASE_PATH}/model-billing-matrix`),
    ).toMatchObject({
      icon: 'pricing',
    });
    expect(
      modelApiItems.find((item) => item.path === `${ADMIN_BASE_PATH}/model-policy`),
    ).toMatchObject({
      icon: 'models',
    });
  });

  it('describes the model center using current admin concepts', () => {
    const modelApiGroup = ADMIN_NAV_GROUPS.find((group) => group.key === 'ai-platform');
    const providerItem = modelApiGroup?.items.find(
      (item) => item.path === `${ADMIN_BASE_PATH}/providers`,
    );

    expect(providerItem?.icon).toBe('providers');
    expect(ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.icon))).not.toContain(
      'newapi',
    );
    expect(providerItem?.description).not.toContain('NewAPI / OpenAI');
    expect(collectPaths()).not.toContain(`${ADMIN_BASE_PATH}/newapi-providers`);
  });

  it('keeps module apps in the extensibility admin module after platform plugin removal', () => {
    const pluginGroup = ADMIN_NAV_GROUPS.find((group) => group.key === 'module-apps');

    expect(pluginGroup).toMatchObject({
      icon: 'plugins',
    });
    expect(pluginGroup?.items).toContainEqual(
      expect.objectContaining({
        icon: 'plugins',
        path: `${ADMIN_BASE_PATH}/modules`,
      }),
    );
    expect(pluginGroup?.items.map((item) => item.path)).not.toContain(
      `${ADMIN_BASE_PATH}/platform-plugins`,
    );
    expect(getAdminSelectedKey('/settings/admin/platform-plugins')).toBe(ADMIN_BASE_PATH);
    expect(getAdminOpenKeys('/settings/admin/platform-plugins')).toEqual(['overview']);
    expect(getAdminSelectedKey('/settings/admin/modules')).toBe(`${ADMIN_BASE_PATH}/modules`);
    expect(getAdminSelectedKey('/settings/admin/modules/apps/app-1/products')).toBe(
      `${ADMIN_BASE_PATH}/modules`,
    );
    expect(getAdminSelectedKey('/settings/admin/module-apps')).toBe(ADMIN_BASE_PATH);
    expect(getAdminOpenKeys('/settings/admin/modules')).toEqual(['module-apps']);
    expect(getAdminOpenKeys('/settings/admin/module-apps')).toEqual(['overview']);
  });

  it('keeps storage and maintenance settings in their approved modules', () => {
    const clientItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'client-integrations')?.items ?? [];
    const systemItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'system-security')?.items ?? [];

    expect(
      clientItems.find((item) => item.path === `${ADMIN_BASE_PATH}/file-storage`),
    ).toMatchObject({
      icon: 'file-storage',
    });
    expect(
      systemItems.find((item) => item.path === `${ADMIN_BASE_PATH}/maintenance`),
    ).toMatchObject({
      icon: 'maintenance',
    });
    expect(
      ADMIN_NAV_GROUPS.flatMap((group) => group.items).find(
        (item) => item.path === `${ADMIN_BASE_PATH}/content-operations`,
      )?.description,
    ).not.toContain('閫氱煡淇濈暀鏃堕棿');
  });

  it('moves desktop client settings into the client module', () => {
    const clientItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'client-integrations')?.items ?? [];
    const systemItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'system-security')?.items ?? [];

    expect(clientItems).toContainEqual(
      expect.objectContaining({
        icon: 'desktop',
        label: '桌面端控制中心',
        path: `${ADMIN_BASE_PATH}/desktop-update`,
      }),
    );
    expect(systemItems.map((item) => item.path)).not.toContain(`${ADMIN_BASE_PATH}/desktop-update`);
    expect(getAdminOpenKeys('/settings/admin/desktop-update')).toEqual(['client-integrations']);
  });

  it('adds mobile client settings to the client module', () => {
    const clientItems =
      ADMIN_NAV_GROUPS.find((group) => group.key === 'client-integrations')?.items ?? [];

    expect(clientItems).toContainEqual(
      expect.objectContaining({
        icon: 'mobile',
        label: '移动端控制中心',
        path: `${ADMIN_BASE_PATH}/mobile`,
      }),
    );
    expect(getAdminSelectedKey('/settings/admin/mobile')).toBe(`${ADMIN_BASE_PATH}/mobile`);
    expect(getAdminOpenKeys('/settings/admin/mobile')).toEqual(['client-integrations']);
  });

  it('normalizes legacy root admin URLs before selecting the sidebar item', () => {
    expect(getAdminSelectedKey('/admin')).toBe(ADMIN_BASE_PATH);
    expect(getAdminSelectedKey('/admin/users')).toBe(`${ADMIN_BASE_PATH}/users`);
  });

  it('selects the nearest admin item for nested URLs and opens its module', () => {
    expect(getAdminSelectedKey('/settings/admin')).toBe(ADMIN_BASE_PATH);
    expect(getAdminSelectedKey('/settings/admin/users/abc')).toBe(`${ADMIN_BASE_PATH}/users`);
    expect(getAdminSelectedKey('/settings/admin/providers/edit')).toBe(
      `${ADMIN_BASE_PATH}/providers`,
    );
    expect(getAdminSelectedKey('/settings/admin/model-billing-matrix')).toBe(
      `${ADMIN_BASE_PATH}/model-billing-matrix`,
    );
    expect(getAdminSelectedKey('/settings/admin/ppt')).toBe(`${ADMIN_BASE_PATH}/ppt`);
    expect(getAdminSelectedKey('/settings/admin/modules')).toBe(`${ADMIN_BASE_PATH}/modules`);
    expect(getAdminSelectedKey('/settings/admin/file-storage')).toBe(
      `${ADMIN_BASE_PATH}/file-storage`,
    );
    expect(getAdminSelectedKey('/settings/admin/maintenance')).toBe(
      `${ADMIN_BASE_PATH}/maintenance`,
    );
    expect(getAdminSelectedKey('/settings/admin/desktop-update')).toBe(
      `${ADMIN_BASE_PATH}/desktop-update`,
    );

    expect(getAdminOpenKeys('/settings/admin/providers/edit')).toEqual(['ai-platform']);
    expect(getAdminOpenKeys('/settings/admin/model-billing-matrix')).toEqual(['ai-platform']);
    expect(getAdminOpenKeys('/settings/admin/ppt')).toEqual(['ai-platform']);
    expect(getAdminOpenKeys('/settings/admin/modules')).toEqual(['module-apps']);
    expect(getAdminOpenKeys('/settings/admin/file-storage')).toEqual(['client-integrations']);
    expect(getAdminOpenKeys('/settings/admin/maintenance')).toEqual(['system-security']);
    expect(getAdminOpenKeys('/settings/admin/desktop-update')).toEqual(['client-integrations']);
  });

  it('resolves the visible group and item for the current admin route', () => {
    expect(getAdminNavigationContext('admin', `${ADMIN_BASE_PATH}/providers/edit`)).toMatchObject({
      group: { key: 'ai-platform', label: 'AI 平台' },
      item: { path: `${ADMIN_BASE_PATH}/providers` },
    });
    expect(getAdminNavigationContext('finance_admin', `${ADMIN_BASE_PATH}/settings`)).toBeNull();
  });

  it('filters admin navigation by group, item label, and description', () => {
    const groups = getAdminNavGroupsForRole('admin');
    const providerMatches = filterAdminNavGroups(groups, '服务商');

    expect(providerMatches).toHaveLength(1);
    expect(providerMatches[0]).toMatchObject({ key: 'ai-platform' });
    expect(providerMatches[0].items.map((item) => item.path)).toContain(
      `${ADMIN_BASE_PATH}/providers`,
    );
    expect(filterAdminNavGroups(groups, '客户端与集成')[0]).toMatchObject({
      key: 'client-integrations',
    });
    expect(filterAdminNavGroups(groups, '不存在的入口')).toEqual([]);
    expect(filterAdminNavGroups(groups, '  ')).toBe(groups);
  });
});
