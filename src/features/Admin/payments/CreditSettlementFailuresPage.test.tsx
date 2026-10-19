import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreditSettlementFailuresPage from './CreditSettlementFailuresPage';

const service = vi.hoisted(() => ({
  listCreditSettlementFailures: vi.fn(),
  retryCreditSettlementFailure: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const state = vi.hoisted(() => ({
  data: { items: [], nextCursor: null } as { items: any[]; nextCursor: null | number },
  error: undefined as Error | undefined,
}));

vi.mock('@lobechat/types', () => ({
  ADMIN_CAPABILITIES: { financeWrite: 'finance.write' },
  hasAdminCapability: () => true,
}));
vi.mock('@/features/Admin/adminCreditUnits', () => ({
  formatAdminCredits: (value: number) => String(value),
}));
vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: service }));
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
vi.mock('@/components/InlineTable', () => ({
  default: ({ columns, dataSource }: any) => (
    <div>
      {dataSource.map((row: any) => (
        <div key={row.id}>
          {columns.map((column: any) => (
            <span key={column.key ?? column.dataIndex}>
              {column.render
                ? column.render(column.dataIndex ? row[column.dataIndex] : undefined, row)
                : row[column.dataIndex]}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, icon: _icon, loading: _loading, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Select: ({ options, onChange, ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  confirmModal: ({ onOk }: any) => onOk?.(),
  toast,
}));
vi.mock('antd', () => ({
  Alert: ({ message }: any) => <div role="alert">{message}</div>,
  Space: ({ children }: any) => <div>{children}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const failureId = '00000000-0000-4000-8000-000000000020';

describe('CreditSettlementFailuresPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
  });

  it('restores the settlement filter without reusing payment-order status', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/admin/payments?tab=settlements&status=paid&settlementStatus=pending&settlementCursor=25',
        ]}
      >
        <CreditSettlementFailuresPage canWrite={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(service.listCreditSettlementFailures).toHaveBeenCalledWith({
        cursor: 25,
        limit: 25,
        status: 'pending',
      }),
    );
    expect(screen.getByTestId('credit-settlement-failures-page')).toBeInTheDocument();
  });

  it('retries a pending settlement through the audited admin action', async () => {
    state.data = {
      items: [
        {
          actualAmount: 12,
          attempts: 2,
          createdAt: '2026-07-27T00:00:00.000Z',
          errorCode: 'TEMPORARY_DB_FAILURE',
          errorMessage: 'database unavailable',
          id: failureId,
          lastAttemptAt: '2026-07-27T00:00:00.000Z',
          payerScopeType: 'personal',
          payerUserId: 'user-1',
          payerWorkspaceId: null,
          reservationId: '00000000-0000-4000-8000-000000000021',
          reservationStatus: 'settlement_failed',
          resolvedAt: null,
          status: 'pending',
          updatedAt: '2026-07-27T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    service.retryCreditSettlementFailure.mockResolvedValue({ status: 'resolved' });
    render(
      <MemoryRouter initialEntries={['/admin/payments?tab=settlements']}>
        <CreditSettlementFailuresPage canWrite />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'admin.payments.settlements.retry' }));

    await waitFor(() =>
      expect(service.retryCreditSettlementFailure).toHaveBeenCalledWith(failureId),
    );
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('admin.payments.settlements.retrySuccess');
  });
});
