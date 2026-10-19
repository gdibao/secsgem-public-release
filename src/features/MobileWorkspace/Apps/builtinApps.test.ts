import { describe, expect, it } from 'vitest';

import type { MobileBuiltinAppV1 } from '@/const/mobileConfig';

import { buildMobileBuiltinApps, buildMobileModuleApps } from './builtinApps';

describe('buildMobileBuiltinApps', () => {
  it('merges known overrides while rejecting hidden, unknown, and unsafe entries', () => {
    const items: MobileBuiltinAppV1[] = [
      {
        enabled: true,
        icon: 'bell',
        id: 'settings',
        label: 'Preferences',
        order: 1,
        path: '/settings/general',
      },
      {
        enabled: true,
        icon: 'list-todo',
        id: 'tasks',
        label: 'Work',
        order: 2,
        path: 'javascript:alert(1)',
      },
      {
        enabled: false,
        icon: 'users',
        id: 'community',
        label: 'Community',
        order: 3,
        path: '/community',
      },
      {
        enabled: true,
        icon: 'store',
        id: 'unknown',
        label: 'Unknown',
        order: 4,
        path: '/unknown',
      },
    ];

    const result = buildMobileBuiltinApps(items);

    expect(result[0]).toMatchObject({
      icon: 'bell',
      id: 'settings',
      label: 'Preferences',
      path: '/settings/general',
    });
    expect(result.find((item) => item.id === 'tasks')).toMatchObject({
      label: 'Work',
      path: '/tasks',
    });
    expect(result.find((item) => item.id === 'skills')).toMatchObject({
      path: '/discover/skill',
    });
    expect(result.some((item) => item.id === 'community')).toBe(false);
    expect(result.some((item) => item.id === 'unknown')).toBe(false);
  });
});

describe('buildMobileModuleApps', () => {
  it('prioritizes featured apps and removes unavailable installations', () => {
    const result = buildMobileModuleApps(
      [
        {
          displayName: 'General app',
          id: 'general/app',
          installed: true,
          installationScope: 'personal',
          planState: { runnable: true },
          status: 'published',
        },
        {
          displayName: 'Featured app',
          icon: 'https://cdn.example.com/featured.png',
          id: 'featured-app',
          installed: true,
          installationScope: 'workspace',
          planState: { runnable: true },
          status: 'published',
          workspaceId: 'workspace-1',
        },
        {
          displayName: 'Draft app',
          id: 'draft-app',
          installed: true,
          installationScope: 'personal',
          planState: { runnable: true },
          status: 'draft',
        },
        {
          displayName: 'Removed app',
          id: 'removed-app',
          installed: false,
          installationScope: 'personal',
          planState: { runnable: true },
          status: 'published',
        },
        {
          displayName: 'Blocked app',
          id: 'blocked-app',
          installed: true,
          installationScope: 'personal',
          planState: { runnable: false },
          status: 'published',
        },
      ],
      ['featured-app', 'missing-app'],
    );

    expect(result.map((item) => item.id)).toEqual(['featured-app', 'general/app']);
    expect(result[0]).toMatchObject({
      icon: 'https://cdn.example.com/featured.png',
      routePath: '/apps/featured-app/app?workspaceId=workspace-1&scopeType=workspace',
    });
    expect(result[1].routePath).toBe('/apps/general%2Fapp/app');
  });
});
