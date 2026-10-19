import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleArtifactsPage from './artifacts/ModuleArtifactsPage';
import ModuleInstallsPage from './installs/ModuleInstallsPage';
import ModuleRecordsPage from './records/ModuleRecordsPage';
import ModuleRunsPage from './runs/ModuleRunsPage';

const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

const moduleApps = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ id: 'app-1', displayName: 'App One' }),
  list: vi.fn().mockResolvedValue({
    items: [{ displayName: 'App One', id: 'app-1', slug: 'app-one' }],
    nextCursor: null,
  }),
  listArtifacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listAuditEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listInstalls: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listRecords: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listRuns: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    return { data: { items: [], nextCursor: null }, error: undefined, isLoading: false };
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: 'admin' } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType = 'button', ...props }: any) => (
    <button type={htmlType} {...props}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
  Select: ({ onChange, options = [], ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('module app operations pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests only runs for the selected app', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/operations/runs?appId=app-1']}>
        <ModuleRunsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(moduleApps.listRuns).toHaveBeenCalled());
    expect(moduleApps.listRuns).toHaveBeenCalledWith({
      appId: 'app-1',
      cursor: undefined,
      limit: 25,
    });
    expect(moduleApps.listInstalls).not.toHaveBeenCalled();
    expect(moduleApps.listRecords).not.toHaveBeenCalled();
    expect(moduleApps.listArtifacts).not.toHaveBeenCalled();
    expect(moduleApps.listAuditEvents).not.toHaveBeenCalled();
    expect(screen.getByTestId('module-runs-page')).toBeInTheDocument();
  });

  it.each([
    ['installs', ModuleInstallsPage, 'listInstalls'],
    ['records', ModuleRecordsPage, 'listRecords'],
    ['artifacts', ModuleArtifactsPage, 'listArtifacts'],
  ] as const)('requests only %s for the selected app', async (_name, Page, serviceName) => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/operations/view?appId=app-1']}>
        <Page />
      </MemoryRouter>,
    );

    await waitFor(() => expect(moduleApps[serviceName]).toHaveBeenCalled());
    expect(moduleApps[serviceName]).toHaveBeenCalledWith({
      appId: 'app-1',
      cursor: undefined,
      limit: 25,
    });
    for (const sibling of [
      'listArtifacts',
      'listAuditEvents',
      'listInstalls',
      'listRecords',
      'listRuns',
    ] as const) {
      if (sibling !== serviceName) expect(moduleApps[sibling]).not.toHaveBeenCalled();
    }
  });

  it('does not request an operation endpoint before an app is selected', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/operations/runs']}>
        <ModuleRunsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('module-operation-app-required')).toBeInTheDocument();
    expect(moduleApps.listRuns).not.toHaveBeenCalled();
  });

  it('can recover from an empty cursor page without losing the selected app', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/operations/records?appId=app-1&cursor=empty-page&previousCursor=',
        ]}
      >
        <ModuleRecordsPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.center.state.clearFilters' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('appId=app-1');
    expect(screen.getByTestId('location')).not.toHaveTextContent('cursor');
  });
});
