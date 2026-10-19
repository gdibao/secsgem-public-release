import { describe, expect, it } from 'vitest';

import { ENGINEERING_TOOL_DESTINATIONS } from './engineeringToolDestination';
import {
  DEFAULT_MOBILE_CONFIG,
  normalizeMobileConfig,
  validateMobileInternalPath,
} from './mobileConfig';

describe('mobile configuration', () => {
  it('returns the four-slot default configuration when the input is missing', () => {
    expect(normalizeMobileConfig(undefined)).toEqual(DEFAULT_MOBILE_CONFIG);
    expect(DEFAULT_MOBILE_CONFIG.applications.builtins.map((item) => item.id)).toEqual([
      'tasks',
      'skills',
      'community',
      'membership',
      'credits',
      'usage',
      'settings',
    ]);
  });

  it('accepts only safe internal paths', () => {
    expect(validateMobileInternalPath('/design?template=brief#new')).toBe(true);
    expect(validateMobileInternalPath('javascript:alert(1)')).toBe(false);
    expect(validateMobileInternalPath('//example.com')).toBe(false);
    expect(validateMobileInternalPath(' /design')).toBe(false);
    expect(validateMobileInternalPath('/design\\escape')).toBe(false);
    expect(validateMobileInternalPath('/design%5Cescape')).toBe(false);
    expect(validateMobileInternalPath('/design%0Aescape')).toBe(false);
  });

  it('repairs syntactically safe but unsupported mobile navigation destinations', () => {
    const config = normalizeMobileConfig({
      navigation: {
        items: [
          { id: 'slot-1', path: '/admin' },
          { id: 'slot-2', path: '/settings/profile' },
          { id: 'slot-3', path: '/community' },
          { id: 'slot-4', path: '/tasks' },
        ],
      },
      version: 1,
    });

    expect(config.navigation.items.map((item) => item.path)).toEqual([
      '/',
      ENGINEERING_TOOL_DESTINATIONS.catalog,
      '/community',
      '/tasks',
    ]);
  });

  it('normalizes a version 1 configuration into safe stable entries', () => {
    const config = normalizeMobileConfig({
      applications: {
        builtins: [
          {
            enabled: false,
            icon: 'list-todo',
            id: ' tasks ',
            label: '任务',
            order: 10,
            path: '/tasks',
          },
          { enabled: true, icon: 'unsafe', id: 'bad', label: '坏项', order: 1, path: '/bad' },
        ],
        featuredModuleAppIds: [' beta ', 'alpha', 'beta', '', 'x'.repeat(129)],
      },
      brand: { displayName: '  品牌  ', logoUrl: ' https://cdn.example.com/logo.svg ' },
      design: {
        tools: [
          { enabled: false, icon: 'image', id: 'image', label: '图像', order: 9 },
          { enabled: true, icon: 'unsafe', id: 'ppt', label: '演示文稿', order: 1 },
        ],
      },
      discover: {
        assistants: [
          { assistantId: ' a ', model: ' m ', order: 4, provider: ' p ' },
          { assistantId: 'b', model: 'm', order: 3, provider: 'p', titleOverride: '助手 B' },
          { assistantId: 'c', model: 'm', order: 2, provider: 'p' },
          { assistantId: 'd', model: 'm', order: 1, provider: 'p' },
          { assistantId: 'e', model: 'm', order: 5, provider: 'p' },
        ],
        title: '探索',
      },
      navigation: {
        items: [
          {
            icon: 'bell',
            id: 'slot-1',
            label: '收件箱',
            order: 9,
            path: '/inbox?tab=all#top',
            visible: true,
          },
          {
            icon: 'palette',
            id: 'slot-2',
            label: '设计',
            order: 1,
            path: '/inbox?tab=all#top',
            visible: true,
          },
          {
            icon: 'invalid',
            id: 'slot-3',
            label: '名称超过六个中文字符',
            order: 2,
            path: '/discover',
            visible: false,
          },
          { icon: 'shapes', id: 'slot-4', label: '应用', order: 3, path: '/apps', visible: false },
          { icon: 'bot', id: 'unknown', label: '未知', order: 4, path: '/unknown', visible: true },
        ],
      },
      version: 1,
    });

    expect(config).toMatchObject({
      applications: {
        featuredModuleAppIds: ['beta', 'alpha'],
      },
      brand: { displayName: '品牌', logoUrl: 'https://cdn.example.com/logo.svg' },
      design: {
        tools: [
          { enabled: true, icon: 'presentation', id: 'ppt', label: '演示文稿', order: 1 },
          { enabled: true, icon: 'file-text', id: 'document', label: '文稿', order: 2 },
          { enabled: false, icon: 'image', id: 'image', label: '图像', order: 3 },
        ],
      },
      discover: { title: '探索' },
    });
    expect(config.applications.builtins).toHaveLength(7);
    expect(config.applications.builtins.find((item) => item.id === 'skills')).toMatchObject({
      enabled: true,
      path: '/discover/skill',
    });
    expect(config.applications.builtins.find((item) => item.id === 'tasks')).toMatchObject({
      enabled: false,
      icon: 'list-todo',
      label: '任务',
      order: 7,
      path: '/tasks',
    });
    expect(config.discover.assistants).toHaveLength(4);
    expect(config.discover.assistants.map((assistant) => assistant.assistantId)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
    expect(config.navigation.items).toHaveLength(4);
    expect(config.navigation.items.map((item) => item.order)).toEqual([1, 2, 3, 4]);
    expect(config.navigation.items.find((item) => item.id === 'slot-1')).toMatchObject({
      icon: 'bell',
      label: '收件箱',
      path: '/',
    });
    expect(config.navigation.items.find((item) => item.id === 'slot-2')?.path).toBe(ENGINEERING_TOOL_DESTINATIONS.catalog);
    expect(config.navigation.items.find((item) => item.id === 'slot-3')).toMatchObject({
      icon: 'compass',
      label: '发现',
    });
    expect(config.navigation.items.find((item) => item.id === 'slot-4')?.path).toBe('/apps');
    expect(config.navigation.items.filter((item) => item.visible)).toHaveLength(4);
  });

  it('keeps syntactically valid catalog IDs and removes assistants with malformed IDs', () => {
    const config = normalizeMobileConfig({
      discover: {
        assistants: [
          {
            assistantId: ' valid-assistant ',
            model: ' model/family:variant@2025+fast ',
            order: 1,
            provider: ' provider/catalog:v1 ',
          },
          { assistantId: 'bad-provider', model: 'model', order: 2, provider: 'bad provider' },
          { assistantId: 'bad-model', model: 'model?variant', order: 3, provider: 'provider' },
          { assistantId: 'control', model: 'bad\u0000model', order: 4, provider: 'provider' },
          { assistantId: 'too-long', model: 'm'.repeat(129), order: 5, provider: 'provider' },
          { assistantId: '', model: 'model', order: 6, provider: 'provider' },
        ],
      },
      version: 1,
    });

    expect(config.discover.assistants).toEqual([
      {
        assistantId: 'valid-assistant',
        model: 'model/family:variant@2025+fast',
        order: 1,
        provider: 'provider/catalog:v1',
      },
    ]);
  });

  it('migrates only the untouched legacy Design tab and preserves custom Design links', () => {
    const legacy = normalizeMobileConfig({ navigation: { items: [{ id: 'slot-2', icon: 'palette', label: '设计', path: '/design' }] }, version: 1 });
    expect(legacy.navigation.items.find((item) => item.id === 'slot-2')).toMatchObject({
      icon: 'boxes', label: '工具', path: ENGINEERING_TOOL_DESTINATIONS.catalog,
    });
    const customized = normalizeMobileConfig({ navigation: { items: [{ id: 'slot-2', icon: 'palette', label: '文稿', path: '/design' }] }, version: 1 });
    expect(customized.navigation.items.find((item) => item.id === 'slot-2')?.path).toBe('/design');
  });

  it('falls back from malformed versions without sharing mutable defaults', () => {
    const normalized = normalizeMobileConfig({ version: 2 });

    normalized.navigation.items[0].label = '已修改';

    expect(normalized).not.toBe(DEFAULT_MOBILE_CONFIG);
    expect(normalized.navigation.items).not.toBe(DEFAULT_MOBILE_CONFIG.navigation.items);
    expect(DEFAULT_MOBILE_CONFIG.navigation.items[0].label).toBe('最近');
  });

  it('repairs only an unsafe navigation path and preserves other valid slot fields', () => {
    const config = normalizeMobileConfig({
      navigation: {
        items: [
          {
            icon: 'bell',
            id: 'slot-1',
            label: 'Inbox',
            order: 4,
            path: 'javascript:alert(1)',
            visible: false,
          },
          {
            icon: 'palette',
            id: 'slot-2',
            label: 'Design',
            order: 1,
            path: '/design',
            visible: true,
          },
          {
            icon: 'compass',
            id: 'slot-3',
            label: 'Discover',
            order: 2,
            path: '/discover',
            visible: true,
          },
          {
            icon: 'shapes',
            id: 'slot-4',
            label: 'Apps',
            order: 3,
            path: '/apps',
            visible: true,
          },
        ],
      },
      version: 1,
    });

    expect(config.navigation.items.find((item) => item.id === 'slot-1')).toEqual({
      icon: 'bell',
      id: 'slot-1',
      label: 'Inbox',
      order: 4,
      path: '/',
      visible: true,
    });
  });

  it('repairs duplicate custom Design paths using the new slot default', () => {
    const config = normalizeMobileConfig({
      navigation: {
        items: [
          {
            icon: 'bell',
            id: 'slot-1',
            label: 'Inbox',
            order: 1,
            path: '/design',
            visible: true,
          },
          {
            icon: 'palette',
            id: 'slot-2',
            label: 'Design',
            order: 2,
            path: '/design',
            visible: true,
          },
        ],
      },
      version: 1,
    });

    expect(config.navigation.items.find((item) => item.id === 'slot-1')).toMatchObject({
      icon: 'bell',
      label: 'Inbox',
      order: 1,
      path: '/design',
      visible: true,
    });
    expect(config.navigation.items.find((item) => item.id === 'slot-2')?.path).toBe(ENGINEERING_TOOL_DESTINATIONS.catalog);
  });
});
