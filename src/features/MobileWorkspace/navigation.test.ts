import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MOBILE_CONFIG,
  type MobilePublicConfigV1,
  normalizeMobileConfig,
} from '@/const/mobileConfig';

import { resolveMobileActiveSlot, shouldShowMobileTabBar } from './navigation';

const configWithNavigation = (
  patches: Partial<MobilePublicConfigV1['navigation']['items'][number]>[],
) =>
  normalizeMobileConfig({
    ...DEFAULT_MOBILE_CONFIG,
    navigation: {
      items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item, index) => ({
        ...item,
        ...patches[index],
      })),
    },
  });

describe('mobile workspace navigation', () => {
  it('resolves default root and deep community routes to stable slots', () => {
    expect(resolveMobileActiveSlot('/', DEFAULT_MOBILE_CONFIG)).toBe('slot-1');
    expect(resolveMobileActiveSlot('/community/agent/demo', DEFAULT_MOBILE_CONFIG)).toBe('slot-3');
  });

  it('respects renamed, reordered, and controlled tab paths', () => {
    const config = configWithNavigation([
      { label: 'Inbox', order: 4, path: '/settings/usage' },
      { label: 'Create', order: 3, path: '/tasks' },
      { label: 'Explore', order: 1, path: '/community' },
      { label: 'Tools', order: 2, path: '/apps' },
    ]);

    expect(resolveMobileActiveSlot('/community', config)).toBe('slot-3');
    expect(resolveMobileActiveSlot('/apps/detail', config)).toBe('slot-4');
    expect(shouldShowMobileTabBar('/community', config)).toBe(true);
  });

  it('keeps all four primary slots visible after normalizing legacy hidden settings', () => {
    const config = configWithNavigation([
      { order: 2 },
      { order: 3 },
      { order: 1, visible: false },
      { order: 4 },
    ]);

    expect(resolveMobileActiveSlot('/community', config)).toBe('slot-3');
  });

  it('shows the tab bar only on top-level mobile workspace pages', () => {
    expect(shouldShowMobileTabBar('/')).toBe(true);
    expect(shouldShowMobileTabBar('/design')).toBe(true);
    expect(shouldShowMobileTabBar('/engineering-tools?view=favorites')).toBe(true);
    expect(resolveMobileActiveSlot('/acme/engineering-tools?view=local_mcp', DEFAULT_MOBILE_CONFIG, 'acme')).toBe('slot-2');
    expect(shouldShowMobileTabBar('/discover')).toBe(true);
    expect(shouldShowMobileTabBar('/apps')).toBe(true);
    expect(shouldShowMobileTabBar('/community/agent')).toBe(true);
    expect(shouldShowMobileTabBar('/ppt')).toBe(false);
    expect(shouldShowMobileTabBar('/image')).toBe(false);
    expect(shouldShowMobileTabBar('/page/document-1')).toBe(false);
    expect(shouldShowMobileTabBar('/apps/market')).toBe(false);
    expect(shouldShowMobileTabBar('/apps/module-1')).toBe(false);
    expect(shouldShowMobileTabBar('/agent/a/topic')).toBe(false);
    expect(shouldShowMobileTabBar('/community/agent/demo')).toBe(false);
    expect(shouldShowMobileTabBar('/settings')).toBe(false);
  });

  it('recognizes workspace-mirrored tab roots without treating deep pages as roots', () => {
    expect(resolveMobileActiveSlot('/acme/apps', DEFAULT_MOBILE_CONFIG, 'acme')).toBe('slot-4');
    expect(shouldShowMobileTabBar('/acme/design', DEFAULT_MOBILE_CONFIG, 'acme')).toBe(true);
    expect(shouldShowMobileTabBar('/acme/apps/market', DEFAULT_MOBILE_CONFIG, 'acme')).toBe(false);
  });
});
