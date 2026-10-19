import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SettingsLayout from './index';

const locationMock = vi.hoisted(() => ({ pathname: '/settings/admin' }));

vi.mock('react-router', () => ({
  Outlet: () => <div data-testid="settings-outlet" />,
  useLocation: () => locationMock,
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock('@/routes/(main)/settings/_layout/SideBar', () => ({
  default: () => <aside data-testid="personal-settings-sidebar" />,
}));
vi.mock('./ContextProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(() => {
  locationMock.pathname = '/settings/admin';
});

describe('SettingsLayout', () => {
  it('gives admin routes the full settings workspace without the personal sidebar', () => {
    render(<SettingsLayout />);

    expect(screen.queryByTestId('personal-settings-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-outlet')).toBeInTheDocument();
  });

  it('keeps the personal sidebar on regular settings routes', () => {
    locationMock.pathname = '/settings/profile';

    render(<SettingsLayout />);

    expect(screen.getByTestId('personal-settings-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-settings-workspace')).not.toBeInTheDocument();
  });
});
