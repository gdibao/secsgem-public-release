import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useOutletContext } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { AdminModuleAppDetail } from '../types';
import ModuleAppDetailLayout, { type ModuleAppDetailOutletContext } from './ModuleAppDetailLayout';
import ModuleCenterLayout, { shouldUseModuleNavigationSheet } from './ModuleCenterLayout';

const detailState = vi.hoisted(() => ({
  app: undefined as AdminModuleAppDetail | undefined,
  error: undefined as unknown,
  isLoading: false,
  refresh: vi.fn(),
}));

vi.mock('../shared/useModuleAppDetail', () => ({ useModuleAppDetail: () => detailState }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }),
}));
vi.mock('../navigation/ModuleSectionNav', () => ({
  default: ({ mode }: { mode?: string }) => <nav data-testid={`module-nav-${mode ?? 'center'}`} />,
}));

const DetailChild = () => {
  const { app } = useOutletContext<ModuleAppDetailOutletContext>();
  return <div>{app.displayName} child</div>;
};

describe('module layouts', () => {
  it('moves module navigation into a sheet below the extra-large breakpoint', () => {
    expect(shouldUseModuleNavigationSheet({ mobile: false, xl: false })).toBe(true);
    expect(shouldUseModuleNavigationSheet({ mobile: false, xl: true })).toBe(false);
    expect(shouldUseModuleNavigationSheet({ mobile: true, xl: true })).toBe(true);
  });

  it('renders center navigation beside nested route content', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules']}>
        <Routes>
          <Route element={<ModuleCenterLayout />} path="/settings/admin/modules">
            <Route index element={<div>center content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('module-nav-center')).toBeInTheDocument();
    expect(screen.getByText('center content')).toBeInTheDocument();
  });

  it('renders a stable app header and provides app context to nested routes', () => {
    detailState.app = {
      actions: [],
      appType: 'standard_app',
      category: 'productivity',
      displayName: 'Calendar',
      entitlements: [],
      icon: 'calendar',
      id: 'app-1',
      pages: [],
      slug: 'calendar',
      status: 'draft',
    } as AdminModuleAppDetail;
    detailState.error = undefined;
    detailState.isLoading = false;

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/apps/app-1']}>
        <Routes>
          <Route element={<ModuleAppDetailLayout />} path="/settings/admin/modules/apps/:appId">
            <Route index element={<DetailChild />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByTestId('module-nav-detail')).toBeInTheDocument();
    expect(screen.getByText('Calendar child')).toBeInTheDocument();
  });

  it('shows a true not-found state without rendering nested detail content', () => {
    detailState.app = undefined;
    detailState.error = undefined;
    detailState.isLoading = false;

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/apps/missing']}>
        <Routes>
          <Route element={<ModuleAppDetailLayout />} path="/settings/admin/modules/apps/:appId">
            <Route element={<Outlet />}>
              <Route index element={<div>should not render</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('appNotFoundTitle')).toBeInTheDocument();
    expect(screen.queryByText('should not render')).not.toBeInTheDocument();
  });
});
