import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileDeepPageGuard from './MobileDeepPageGuard';

const navigate = vi.fn();
const location = vi.hoisted(() => ({ key: 'default', pathname: '/apps/market' }));
const workspace = vi.hoisted(() => ({ slug: 'acme' as string | null }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => workspace.slug,
}));
vi.mock('react-router', () => ({
  Outlet: () => <main>Deep page</main>,
  useLocation: () => location,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'back' ? 'Back' : key) }),
}));
vi.mock('@lobehub/ui', () => ({ Icon: () => null }));

describe('MobileDeepPageGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    location.key = 'default';
    location.pathname = '/apps/market';
    workspace.slug = 'acme';
  });

  it.each([
    ['/ppt', '/design'],
    ['/image', '/design'],
    ['/page/document-1', '/design'],
    ['/apps/market', '/apps'],
    ['/apps/module-1', '/apps'],
  ])('uses %s direct-entry fallback %s outside a workspace', (pathname, fallback) => {
    location.pathname = pathname;
    render(<MobileDeepPageGuard />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith(fallback, { escape: true });
  });

  it('uses browser history when the deep route has a previous entry', () => {
    location.key = 'history-entry';
    render(<MobileDeepPageGuard />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('renders one 44px back header and a contained vertically scrolling outlet', () => {
    render(<MobileDeepPageGuard />);

    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('title', 'Back');
    expect(screen.getByTestId('mobile-deep-page-header')).toHaveStyle({
      height: '44px',
    });
    expect(screen.getByTestId('mobile-deep-page-content')).toHaveStyle({
      minHeight: '0',
      overflow: 'hidden auto',
    });
    expect(screen.getByTestId('mobile-deep-page-content')).toContainElement(
      screen.getByRole('main'),
    );
  });

  it('keeps the workspace prefix when a workspace deep route was opened directly', () => {
    location.pathname = '/acme/apps/market';
    render(<MobileDeepPageGuard />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith('/apps');
  });
});
