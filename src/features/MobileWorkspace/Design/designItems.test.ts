import { describe, expect, it } from 'vitest';

import type { MobileDesignToolV1 } from '@/const/mobileConfig';

import { buildMobileDesignTools } from './designItems';

describe('buildMobileDesignTools', () => {
  it('keeps configured presentation, filters disabled tools, and uses existing create routes', () => {
    const tools: MobileDesignToolV1[] = [
      { enabled: true, icon: 'presentation', id: 'ppt', label: 'Slides', order: 3 },
      { enabled: false, icon: 'image', id: 'image', label: 'Images', order: 1 },
      { enabled: true, icon: 'file-text', id: 'document', label: 'Write', order: 2 },
    ];

    expect(buildMobileDesignTools(tools)).toEqual([
      { ...tools[2], routePath: '/page' },
      { ...tools[0], routePath: '/ppt' },
    ]);
  });
});
