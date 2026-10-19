import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAuditPage from './ModuleAuditPage';

const moduleApps = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ displayName: 'App One', id: 'app-1', slug: 'app-one' }),
  list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listAuditEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listArtifacts: vi.fn(),
  listInstalls: vi.fn(),
  listRecords: vi.fn(),
  listRuns: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    return { data: { items: [], nextCursor: null }, error: undefined, isLoading: false };
  },
  mutate: vi.fn(),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: auth.role } }),
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

describe('ModuleAuditPage', () => {
  beforeEach(() => {
    auth.role = 'admin';
    vi.clearAllMocks();
  });

  it('does not request audit events until an app is selected', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/audit']}>
        <ModuleAuditPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('module-audit-app-required')).toBeInTheDocument();
    expect(moduleApps.listAuditEvents).not.toHaveBeenCalled();
  });

  it('requests only read-only audit data for the selected app', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/audit?appId=app-1']}>
        <ModuleAuditPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listAuditEvents).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 25,
      }),
    );
    expect(moduleApps).not.toHaveProperty('deleteAuditEvent');
    expect(moduleApps.listArtifacts).not.toHaveBeenCalled();
    expect(moduleApps.listInstalls).not.toHaveBeenCalled();
    expect(moduleApps.listRecords).not.toHaveBeenCalled();
    expect(moduleApps.listRuns).not.toHaveBeenCalled();
  });

  it('does not request the module app directory for a finance auditor', async () => {
    auth.role = 'finance_admin';

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/audit']}>
        <ModuleAuditPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'app-1' } });
    expect(moduleApps.listAuditEvents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.operations.applyAppId' }));

    await waitFor(() =>
      expect(moduleApps.listAuditEvents).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 25,
      }),
    );
    expect(moduleApps.list).not.toHaveBeenCalled();
    expect(moduleApps.get).not.toHaveBeenCalled();
  });
});
