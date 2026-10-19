import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import ModuleAppsPage from './ModuleAppsPage';

const moduleApps = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listArtifacts: vi.fn(),
  listPackages: vi.fn(),
  listPaymentDiagnostics: vi.fn(),
  listPayouts: vi.fn(),
  listPublishers: vi.fn(),
  listRecords: vi.fn(),
  listRevenue: vi.fn(),
  listRuns: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: 'admin' } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (_key: unknown, fetcher: () => Promise<unknown>) => {
    void fetcher();
    return { data: { items: [], nextCursor: null }, error: undefined, isLoading: false };
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: ({ ...props }: any) => <input data-component="base-input" {...props} />,
  Modal: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  Select: ({ onChange, options, value, ...props }: any) => (
    <select
      data-component="base-select"
      value={value}
      {...props}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option: { label: string; value: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  TextArea: ({ ...props }: any) => <textarea data-component="base-textarea" {...props} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModuleAppsPage', () => {
  it('uses styled controls in the application directory toolbar', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/apps']}>
        <ModuleAppsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('module-app-filters')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'moduleApps.admin.apps.search' })).toHaveAttribute(
      'data-component',
      'base-input',
    );
    expect(
      screen.getByRole('combobox', { name: 'moduleApps.admin.apps.status.label' }),
    ).toHaveAttribute('data-component', 'base-select');
  });

  it('uses only the application list service for the directory request', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/apps?q=work&status=draft']}>
        <ModuleAppsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.list).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'work', status: 'draft' }),
      ),
    );
    expect(moduleApps.listPackages).not.toHaveBeenCalled();
    expect(moduleApps.listPaymentDiagnostics).not.toHaveBeenCalled();
    expect(moduleApps.listPayouts).not.toHaveBeenCalled();
    expect(moduleApps.listPublishers).not.toHaveBeenCalled();
    expect(moduleApps.listRevenue).not.toHaveBeenCalled();
    expect(moduleApps.listRuns).not.toHaveBeenCalled();
    expect(screen.getByTestId('module-app-directory')).toBeInTheDocument();
  });
});
