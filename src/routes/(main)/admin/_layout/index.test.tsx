import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminLayout, { shouldUseAdminNavigationSheet } from './index';

const userStoreMock = vi.hoisted(() => {
  const initialState = {
    isUserStateInit: false,
    user: undefined,
  };
  const state: Record<string, any> = { ...initialState };
  const selectUserStore = ((selector?: (value: typeof state) => any) =>
    typeof selector === 'function' ? selector(state) : state) as any;

  selectUserStore.setState = (patch: Record<string, any>) => {
    Object.assign(state, patch);
  };
  selectUserStore.reset = () => {
    Object.assign(state, initialState);
  };

  return { useUserStore: selectUserStore };
});

const locationMock = vi.hoisted(() => ({ pathname: '/settings/admin' }));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router');

  return {
    ...actual,
    Navigate: ({ replace, to }: { replace?: boolean; to: string }) => (
      <div data-replace={String(Boolean(replace))} data-testid="navigate" data-to={to} />
    ),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    Outlet: () => <div data-testid="admin-outlet" />,
    useLocation: () => locationMock,
  };
});

vi.mock('@/features/Admin', () => ({
  AdminSidebar: () => <div data-testid="admin-sidebar" />,
}));

vi.mock('@/store/user', () => ({
  useUserStore: userStoreMock.useUserStore,
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userProfile: (state: { user?: unknown }) => state.user,
  },
}));

afterEach(() => {
  act(() => {
    userStoreMock.useUserStore.reset();
    locationMock.pathname = '/settings/admin';
  });
});

describe('AdminLayout', () => {
  it('renders a stable skeleton while the user state is still loading', () => {
    render(<AdminLayout />);

    expect(screen.getByTestId('admin-layout-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
  });

  it('redirects initialized visitors without a user away from admin routes', () => {
    act(() => {
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: undefined,
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/');
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-replace', 'true');
    expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
  });

  it('redirects initialized non-admin users away from admin routes', () => {
    act(() => {
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'user-1', role: 'user', username: 'user' },
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/');
  });

  it('renders the admin shell and nested route for admin users', () => {
    act(() => {
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'admin-1', role: 'admin', username: 'admin' },
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('admin-outlet')).toBeInTheDocument();
    expect(screen.getByTestId('admin-context-bar')).toHaveTextContent('工作台');
    expect(screen.getByRole('link', { name: '管理后台' })).toHaveAttribute(
      'href',
      '/settings/admin',
    );
    expect(screen.getByRole('link', { name: '返回前台' })).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('renders the admin shell for recognized scoped admin roles', () => {
    act(() => {
      locationMock.pathname = '/settings/admin/plans';
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'finance-1', role: 'finance_admin', username: 'finance' },
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('admin-outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('moves primary admin navigation into a sheet below the large breakpoint', () => {
    expect(shouldUseAdminNavigationSheet(true)).toBe(true);
    expect(shouldUseAdminNavigationSheet(false)).toBe(false);
  });

  it('shows a navigation command when CSS hides the sidebar at 390px', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    }));
    act(() => {
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'admin-1', role: 'admin', username: 'admin' },
      });
    });

    try {
      render(<AdminLayout />);
      fireEvent.click(screen.getByRole('button', { name: '打开管理导航' }));
      expect(document.querySelector('[data-floating-sheet]')).toHaveAttribute('data-state', 'open');
      expect(screen.getByRole('link', { name: '返回前台' })).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('redirects scoped roles away from cross-domain admin routes', () => {
    act(() => {
      locationMock.pathname = '/settings/admin/settings';
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'finance-1', role: 'finance_admin', username: 'finance' },
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/settings/admin/subscriptions',
    );
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
  });

  it('redirects scoped roles to the first permitted Module Center section', () => {
    act(() => {
      locationMock.pathname = '/settings/admin/modules/apps/app-1/products';
      userStoreMock.useUserStore.setState({
        isUserStateInit: true,
        user: { id: 'finance-1', role: 'finance_admin', username: 'finance' },
      });
    });

    render(<AdminLayout />);

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/settings/admin/modules');
  });
});
