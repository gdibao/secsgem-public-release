import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Layout from './index';

vi.mock('react-router', () => ({ Outlet: () => <div data-testid="community-outlet" /> }));
vi.mock('@/components/server/MobileNavLayout', () => ({
  default: ({ children, withNav }: { children: ReactNode; withNav?: boolean }) => (
    <div data-testid="mobile-content-layout" data-with-nav={String(Boolean(withNav))}>
      {children}
    </div>
  ),
}));
vi.mock('@/features/Setting/Footer', () => ({ default: () => <footer>Footer</footer> }));
vi.mock('../../../../(main)/community/features/const', () => ({
  SCROLL_PARENT_ID: 'community-scroll',
}));
vi.mock('./Header', () => ({ default: () => <header>Community</header> }));
vi.mock('./style', () => ({ styles: { mainContainer: 'community-layout' } }));

describe('mobile community list layout', () => {
  it('delegates bottom navigation to the mobile workspace shell', () => {
    render(<Layout />);

    expect(screen.getByTestId('mobile-content-layout')).toHaveAttribute('data-with-nav', 'false');
    expect(screen.getByTestId('community-outlet')).toBeInTheDocument();
  });
});
