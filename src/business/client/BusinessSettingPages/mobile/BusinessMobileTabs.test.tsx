import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BusinessMobileTabs from './BusinessMobileTabs';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  scrollIntoView: vi.fn(),
  scrollTo: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'mobile.tabs.ariaLabel': '商业设置',
        'tab.billing': '账单',
        'tab.credits': '积分',
        'tab.plans': '套餐',
        'tab.referral': '推荐奖励',
        'tab.usage': '用量',
      })[key] ?? key,
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

const createRect = (left: number, right: number): DOMRect =>
  ({
    bottom: 44,
    height: 44,
    left,
    right,
    toJSON: () => ({}),
    top: 0,
    width: right - left,
    x: left,
    y: 0,
  }) as DOMRect;

let mobileScrollContainer: HTMLDivElement;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
let originalScrollTo: typeof mobileScrollContainer.scrollTo;

beforeEach(() => {
  mobileScrollContainer = document.createElement('div');
  mobileScrollContainer.id = 'lobe-mobile-scroll-container';
  originalScrollTo = mobileScrollContainer.scrollTo;
  mobileScrollContainer.scrollTo = mocks.scrollTo;
  document.body.append(mobileScrollContainer);

  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = mocks.scrollIntoView;

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if ((this as HTMLElement).dataset.tabId === 'referral') return createRect(240, 340);
    return createRect(0, 300);
  });
});

afterEach(() => {
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  }
  mobileScrollContainer.scrollTo = originalScrollTo;
  mobileScrollContainer.remove();
  mocks.navigate.mockReset();
  mocks.scrollIntoView.mockReset();
  mocks.scrollTo.mockReset();
  vi.restoreAllMocks();
});

describe('BusinessMobileTabs', () => {
  it('renders the five commercial tabs and keeps navigation personal-only', () => {
    render(
      <MemoryRouter initialEntries={['/settings/plans']}>
        <BusinessMobileTabs />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: '套餐' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '积分' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings/credits', { escape: true });
    expect(mocks.scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 0 });
  });

  it('scrolls a clipped active tab into view', () => {
    render(
      <MemoryRouter initialEntries={['/settings/referral']}>
        <BusinessMobileTabs />
      </MemoryRouter>,
    );

    expect(mocks.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  });
});
