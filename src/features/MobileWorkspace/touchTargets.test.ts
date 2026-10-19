import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile workspace touch targets', () => {
  it('keeps shared icon actions and conversation menus at least 44px', () => {
    expect(source('../../../packages/const/src/layoutTokens.ts')).toContain(
      "MOBILE_HEADER_ICON_SIZE: ActionIconProps['size'] = { blockSize: 44",
    );
    expect(source('./MobileRefreshButton.tsx')).toContain('min-height: 44px');
    expect(source('./MobileRefreshButton.tsx')).toContain('min-width: 44px');
    expect(source('./Recent/RecentConversationRow.tsx')).toContain('blockSize: 44');
    expect(source('./Apps/index.tsx')).toContain('min-height: 44px');
    expect(source('./Apps/index.tsx')).toContain('min-width: 44px');
  });

  it('compacts state-view whitespace on short landscape screens without shrinking actions', () => {
    const stateView = source('./components/MobileStateView.tsx');

    expect(stateView).toContain('@media (height <= 500px)');
    expect(stateView).toContain('min-height: 72px');
    expect(stateView).toContain('padding-block: 0');
    expect(stateView).toContain('gap: 4px');
    expect(stateView).toContain('minHeight: 44');
  });
});
