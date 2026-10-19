import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleRevenuePage from './ModuleRevenuePage';

const moduleApps = vi.hoisted(() => ({
  listRevenue: vi.fn(),
  settleRevenueBatch: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const state = vi.hoisted(() => ({
  data: { items: [], nextCursor: null } as { items: any[]; nextCursor: null | string },
  error: undefined as Error | undefined,
}));

vi.mock('@lobechat/types', () => ({
  ADMIN_CAPABILITIES: { financeWrite: 'finance.write' },
  hasAdminCapability: () => true,
}));
vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({ user: {} }) }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (store: any) => store.user },
}));
vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: (_key: unknown, fetcher: () => Promise<unknown>) => {
    void fetcher();
    return { data: state.data, error: state.error, isLoading: false };
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
  Modal: (props: any) =>
    props.open ? (
      <div>
        {props.children}
        <button disabled={props.okButtonProps?.disabled} type="button" onClick={props.onOk}>
          {props.okText}
        </button>
      </div>
    ) : null,
  Select: ({ options, onChange, ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModuleRevenuePage', () => {
  beforeEach(() => {
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
    vi.clearAllMocks();
  });

  it('restores revenue filters from the URL and mounts only the revenue endpoint', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/finance/revenue?status=reversed&appId=app-1&publisherId=publisher-1&cursor=cursor-1',
        ]}
      >
        <ModuleRevenuePage canWrite={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listRevenue).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: 'cursor-1',
        limit: 25,
        publisherId: 'publisher-1',
        status: 'reversed',
      }),
    );
    expect(screen.getByTestId('module-revenue-page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.revenue.settle' })).toBeNull();
  });

  it('settles selected revenue and refreshes only its current cache key', async () => {
    state.data = {
      items: [
        {
          appId: 'app-1',
          currency: 'CNY',
          developerAmount: 72,
          grossAmount: 100,
          id: 'entry-1',
          orderId: 'order-1',
          platformFee: 20,
          reserveAmount: 8,
          status: 'pending',
          type: 'accrual',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/finance/revenue?status=pending']}>
        <ModuleRevenuePage canWrite />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.revenue.settle' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.revenue.confirmSettlement' }),
    );

    await waitFor(() =>
      expect(moduleApps.settleRevenueBatch).toHaveBeenCalledWith({ entryIds: ['entry-1'] }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith([
      'admin-module-apps',
      'revenue',
      'status=pending',
      '',
    ]);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
