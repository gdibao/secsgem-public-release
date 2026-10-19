import { ADMIN_CAPABILITIES } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_CATALOG,
  ADMIN_CATALOG_GROUPS,
  getAdminCatalogAccessCapabilities,
} from './adminCatalog';

describe('adminCatalog', () => {
  it('defines the approved eight admin groups in order', () => {
    expect(ADMIN_CATALOG_GROUPS.map((group) => group.key)).toEqual([
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

  it('keeps route IDs, segments, and paths unique', () => {
    expect(new Set(ADMIN_CATALOG.map((item) => item.id)).size).toBe(ADMIN_CATALOG.length);
    expect(new Set(ADMIN_CATALOG.map((item) => item.segment)).size).toBe(ADMIN_CATALOG.length);
    expect(new Set(ADMIN_CATALOG.map((item) => item.path)).size).toBe(ADMIN_CATALOG.length);
  });

  it('assigns default-setting pages to the responsible admin domains', () => {
    const byId = Object.fromEntries(ADMIN_CATALOG.map((item) => [item.id, item]));

    expect(byId['ai-runtime-defaults']).toMatchObject({
      group: 'ai-platform',
      segment: 'ai-runtime-defaults',
    });
    expect(byId['user-defaults']).toMatchObject({
      group: 'user-access',
      segment: 'user-defaults',
    });
    expect(byId.integrations).toMatchObject({
      group: 'client-integrations',
      segment: 'integrations',
    });
    expect(byId.mobile).toMatchObject({
      backendDomains: ['settings'],
      description: '统一管理移动端品牌、底部导航、发现内容和应用入口',
      group: 'client-integrations',
      label: '移动端控制中心',
      owner: 'client',
      path: '/settings/admin/mobile',
      readCapability: ADMIN_CAPABILITIES.systemRead,
      segment: 'mobile',
      status: 'active',
      writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
    });
  });

  it('publishes the desktop control center as an active client surface', () => {
    expect(ADMIN_CATALOG.find(({ id }) => id === 'desktop-update')).toMatchObject({
      description: '统一管理桌面安装、版本、客户端状态和更新设置',
      label: '桌面端控制中心',
      status: 'active',
    });
  });

  it('assigns read capabilities to high-risk domains', () => {
    const byId = Object.fromEntries(ADMIN_CATALOG.map((item) => [item.id, item]));

    expect(byId.users.readCapability).toBe(ADMIN_CAPABILITIES.userRead);
    expect(byId.workspaces).toMatchObject({
      path: '/settings/admin/workspaces',
      readCapability: ADMIN_CAPABILITIES.systemRead,
      writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
    });
    expect(byId.providers.readCapability).toBe(ADMIN_CAPABILITIES.modelOpsRead);
    expect(byId['content-resources'].readCapability).toBe(ADMIN_CAPABILITIES.contentRead);
    expect(byId['content-operations'].readCapability).toBe(ADMIN_CAPABILITIES.systemRead);
    expect(byId.settings.readCapability).toBe(ADMIN_CAPABILITIES.systemRead);
    expect(byId['model-policy'].readCapability).toBe(ADMIN_CAPABILITIES.systemRead);
    expect(byId['model-policy'].writeCapabilities).toEqual([ADMIN_CAPABILITIES.systemWrite]);
    expect(getAdminCatalogAccessCapabilities(byId['model-billing-matrix'])).toEqual([
      ADMIN_CAPABILITIES.modelOpsRead,
      ADMIN_CAPABILITIES.financeRead,
      ADMIN_CAPABILITIES.systemRead,
    ]);
    expect(getAdminCatalogAccessCapabilities(byId.payments)).toEqual([
      ADMIN_CAPABILITIES.systemRead,
      ADMIN_CAPABILITIES.financeRead,
    ]);
    expect(byId.payments.writeCapabilities).toEqual([
      ADMIN_CAPABILITIES.systemWrite,
      ADMIN_CAPABILITIES.financeWrite,
    ]);
    const moduleApps = ADMIN_CATALOG.find((item) => item.id === 'modules');
    expect(moduleApps?.readCapability).toBe(ADMIN_CAPABILITIES.moduleAppRead);
    expect(moduleApps?.segment).toBe('modules');
    expect(moduleApps?.accessCapabilities).toEqual([
      ADMIN_CAPABILITIES.moduleAppRead,
      ADMIN_CAPABILITIES.financeRead,
    ]);
  });
});
