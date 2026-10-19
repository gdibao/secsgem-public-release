import { describe, expect, it } from 'vitest';

import type { FooterPromotionContext } from './promotionPipeline';
import { resolveFooterPromotionState } from './promotionPipeline';

const createContext = (overrides: Partial<FooterPromotionContext> = {}) => ({
  isDesktop: false,
  isMobile: false,
  isProductHuntNotificationRead: false,
  isWithinProductHuntWindow: true,
  serverConfigInit: true,
  ...overrides,
});

describe('resolveFooterPromotionState', () => {
  it('shows the product hunt promotion during its active window', () => {
    expect(resolveFooterPromotionState(createContext())).toEqual({
      shouldAutoShowProductHuntCard: true,
      shouldShowProductHuntMenuEntry: true,
    });
  });

  it('keeps the product hunt menu entry while suppressing auto-open after read', () => {
    expect(
      resolveFooterPromotionState(
        createContext({
          isProductHuntNotificationRead: true,
        }),
      ),
    ).toEqual({
      shouldAutoShowProductHuntCard: false,
      shouldShowProductHuntMenuEntry: true,
    });
  });

  it('returns an empty state when no promotion is eligible', () => {
    expect(
      resolveFooterPromotionState(
        createContext({
          isWithinProductHuntWindow: false,
        }),
      ),
    ).toEqual({
      shouldAutoShowProductHuntCard: false,
      shouldShowProductHuntMenuEntry: false,
    });
  });
});
