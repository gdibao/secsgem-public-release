import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleOverviewPage from './ModuleOverviewPage';

const moduleApps = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listPackages: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listPaymentDiagnostics: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listRuns: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
const auth = vi.hoisted(() => ({ role: 'admin' }));
const errorDomains = vi.hoisted(() => ({ values: new Set<string>() }));

vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    const parts = Array.isArray(key) ? key : [];
    const domain = parts[1] === 'runtime' ? parts[2] : parts[1];
    const error = errorDomains.values.has(domain) ? new Error(`${domain} failed`) : undefined;
    const items =
      domain === 'apps'
        ? [
            {
              appType: 'api',
              category: 'productivity',
              displayName: 'App One',
              icon: 'box',
              id: 'app-1',
              slug: 'app-one',
              status: 'published',
            },
          ]
        : domain === 'packages'
          ? [
              {
                id: 'package-1',
                manifestSnapshot: { app: { displayName: 'Pending App' } },
                reviewStatus: 'pending_review',
                scanStatus: 'clean',
              },
            ]
          : domain === 'payments'
            ? [
                {
                  appName: 'App One',
                  currency: 'CNY',
                  discrepancyStatus: 'open',
                  id: 'payment-1',
                  orderId: 'order-1',
                  paymentStatus: 'failed',
                  totalAmount: '12.00',
                },
              ]
            : domain === 'runs'
              ? [{ id: 'run-1', status: 'denied' }]
              : [];

    return { data: error ? undefined : { items, nextCursor: null }, error, isLoading: false };
  },
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

const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

describe('ModuleOverviewPage', () => {
  beforeEach(() => {
    auth.role = 'admin';
    errorDomains.values.clear();
    vi.clearAllMocks();
  });

  it('loads only module summaries and waits for an explicit app selection before runs', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules']}>
        <ModuleOverviewPage canReadModules canReadFinance={false} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(moduleApps.listPackages).toHaveBeenCalledWith({
        limit: 5,
        reviewStatus: 'pending_review',
      });
      expect(moduleApps.list).toHaveBeenCalledWith({ limit: 5, sort: 'updated_desc' });
    });
    expect(moduleApps.listPaymentDiagnostics).not.toHaveBeenCalled();
    expect(moduleApps.listRuns).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'app-1' } });

    await waitFor(() =>
      expect(moduleApps.listRuns).toHaveBeenCalledWith({ appId: 'app-1', limit: 5 }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('appId=app-1');
  });

  it('loads only open payment discrepancies for a finance administrator', async () => {
    auth.role = 'finance_admin';

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules?appId=app-1']}>
        <ModuleOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listPaymentDiagnostics).toHaveBeenCalledWith({
        discrepancyStatus: 'open',
        limit: 5,
      }),
    );
    expect(moduleApps.list).not.toHaveBeenCalled();
    expect(moduleApps.listPackages).not.toHaveBeenCalled();
    expect(moduleApps.listRuns).not.toHaveBeenCalled();
  });

  it('loads both bounded summary domains for a full administrator', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules?appId=app-1']}>
        <ModuleOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(moduleApps.list).toHaveBeenCalledWith({ limit: 5, sort: 'updated_desc' });
      expect(moduleApps.listPackages).toHaveBeenCalledWith({
        limit: 5,
        reviewStatus: 'pending_review',
      });
      expect(moduleApps.listPaymentDiagnostics).toHaveBeenCalledWith({
        discrepancyStatus: 'open',
        limit: 5,
      });
      expect(moduleApps.listRuns).toHaveBeenCalledWith({ appId: 'app-1', limit: 5 });
    });
    expect(screen.getByRole('link', { name: 'Pending App' })).toHaveAttribute(
      'href',
      '/settings/admin/modules/reviews',
    );
    expect(screen.getByRole('link', { name: 'App One' })).toHaveAttribute(
      'href',
      '/settings/admin/modules/apps/app-1',
    );
    expect(screen.getByRole('link', { name: 'run-1' })).toHaveAttribute(
      'href',
      '/settings/admin/modules/operations/runs?appId=app-1',
    );
    expect(screen.getByText('moduleApps.admin.center.overview.status.denied')).toBeVisible();
    expect(screen.getByRole('link', { name: 'App One / order-1' })).toHaveAttribute(
      'href',
      '/settings/admin/modules/finance/payments?discrepancyStatus=open',
    );
  });

  it('keeps other summaries available when one summary domain fails', async () => {
    errorDomains.values.add('payments');

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules?appId=app-1']}>
        <ModuleOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('link', { name: 'Pending App' })).toBeVisible());
    expect(screen.getByTestId('module-error-state')).toBeVisible();
  });
});
