import { describe, expect, it } from 'vitest';

import { resolveEngineeringToolMenu } from './engineeringToolDestination';

describe('engineering tool navigation', () => {
  it('sorts the shared menu and rejects unsupported routes', () => {
    expect(resolveEngineeringToolMenu([
      { enabled: true, key: 'favorites', label: '我的收藏', path: '/engineering-tools?view=favorites', sortOrder: 2 },
      { enabled: true, key: 'catalog', label: '工具目录', path: '/engineering-tools?view=catalog', sortOrder: 1 },
      { enabled: true, key: 'local_mcp', label: '错误目标', path: '/admin', sortOrder: 3 },
    ]).map((item) => item.key)).toEqual(['catalog', 'favorites']);
  });

  it('projects all three old section slots while retaining order and enabled state', () => {
    expect(resolveEngineeringToolMenu([
      { enabled: true, key: 'image', label: '工艺', path: '/engineering-tools?section=process', sortOrder: 0 },
      { enabled: false, key: 'ppt', label: '自动化', path: '/engineering-tools?section=automation', sortOrder: 1 },
      { enabled: true, key: 'community', label: '设计', path: '/engineering-tools?section=design', sortOrder: 2 },
    ])).toMatchObject([
      { key: 'catalog', enabled: true, path: '/engineering-tools?view=catalog' },
      { key: 'favorites', enabled: false, path: '/engineering-tools?view=favorites' },
      { key: 'local_mcp', enabled: true, path: '/engineering-tools?view=local_mcp' },
    ]);
    expect(resolveEngineeringToolMenu([
      { enabled: false, key: 'image', label: '工艺', path: '/engineering-tools?section=process', sortOrder: 0 },
    ])).toMatchObject([{ key: 'catalog', enabled: false }]);
  });
});
