import { describe, expect, it } from 'vitest';

import { buildSubscriptionEmbedUrl } from './SubscriptionIframeWrapper';

describe('buildSubscriptionEmbedUrl', () => {
  it('builds subscription embeds from the configured server origin', () => {
    expect(buildSubscriptionEmbedUrl('plans', 'https://custom.example.com/', 'zh-CN')).toBe(
      'https://custom.example.com/embed/subscription/plans?hl=zh-CN',
    );
  });
});
