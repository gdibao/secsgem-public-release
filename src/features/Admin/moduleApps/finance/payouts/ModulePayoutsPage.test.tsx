import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModulePayoutsPage from './ModulePayoutsPage';

const moduleApps = vi.hoisted(() => ({
  createPayoutBatch: vi.fn(),
  listPayouts: vi.fn(),
  recordManualAlipayPayout: vi.fn(),
  transitionPayoutBatch: vi.fn(),
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
  TextArea: (props: any) => <textarea {...props} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModulePayoutsPage', () => {
  beforeEach(() => {
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
    vi.clearAllMocks();
  });

  it('restores payout filters from the URL and hides writes for readers', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/finance/payouts?status=failed&publisherId=publisher-1&cursor=cursor-1',
        ]}
      >
        <ModulePayoutsPage canWrite={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listPayouts).toHaveBeenCalledWith({
        cursor: 'cursor-1',
        limit: 25,
        publisherId: 'publisher-1',
        status: 'failed',
      }),
    );
    expect(screen.getByTestId('module-payouts-page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.payouts.create' })).toBeNull();
  });

  it('creates a payout and refreshes only the current payout cache', async () => {
    state.data = {
      items: [
        {
          auditEventIds: [],
          currency: 'CNY',
          id: '00000000-0000-4000-8000-000000000021',
          publisherId: 'publisher-1',
          publisherName: 'Studio',
          revenueEntryIds: [],
          status: 'pending',
          totalAmount: 80,
        },
      ],
      nextCursor: null,
    };
    moduleApps.createPayoutBatch.mockResolvedValue({ id: 'payout-2' });
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/finance/payouts?status=pending']}>
        <ModulePayoutsPage canWrite />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.payouts.create' }));
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.publisherId'), {
      target: { value: '00000000-0000-4000-8000-000000000001' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.requestedAmount'), {
      target: { value: '80' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.revenueEntryIds'), {
      target: { value: '00000000-0000-4000-8000-000000000011' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payouts.confirm.create' }),
    );

    await waitFor(() => expect(moduleApps.createPayoutBatch).toHaveBeenCalled());
    expect(mocks.mutate).toHaveBeenCalledWith([
      'admin-module-apps',
      'payouts',
      'status=pending',
      '',
    ]);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
