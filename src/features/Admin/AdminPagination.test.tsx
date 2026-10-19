import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminCommercialService } from '@/services/adminCommercial';

import AdminChangeRequestsPage from './AdminChangeRequestsPage';
import AdminOrdersPage from './AdminOrdersPage';
import AdminSubscriptionsPage from './AdminSubscriptionsPage';

const paginationData = (key: readonly unknown[]) => {
  const [resource] = key;
  const cursor =
    resource === 'admin-orders' ? key[1] : resource === 'admin-subscriptions' ? key[2] : key[3];
  const initial = cursor === undefined || cursor === 0;

  return { items: [], nextCursor: initial ? 20 : null };
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: readonly unknown[] | null, fetcher: () => Promise<unknown>) => {
    if (!key) return { data: undefined, isLoading: false, mutate: vi.fn() };
    void fetcher();
    return { data: paginationData(key), isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    listChangeRequests: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listOrders: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listSubscriptions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  },
}));

vi.mock('./AdminTopUpPackagesPage', () => ({ default: () => null }));
vi.mock('./AdminBulkActionFlow', () => ({ default: () => null }));

const clickNextAndPrevious = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'admin.pagination.next' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'admin.pagination.previous' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'admin.pagination.previous' }));
};

describe('admin list pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves orders forward and back without arithmetic cursor guesses', async () => {
    render(
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'admin.orders.title' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'admin.orders.tableLabel' })).toBeInTheDocument();

    await clickNextAndPrevious();

    await waitFor(() =>
      expect(adminCommercialService.listOrders).toHaveBeenLastCalledWith({
        cursor: 0,
        limit: 50,
        status: undefined,
        userId: undefined,
      }),
    );
    expect(adminCommercialService.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 20 }),
    );
  });

  it('moves subscriptions forward and back through the returned cursor', async () => {
    render(<AdminSubscriptionsPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'admin.subscriptions.title' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'admin.subscriptions.tableLabel' }),
    ).toBeInTheDocument();

    await clickNextAndPrevious();

    await waitFor(() =>
      expect(adminCommercialService.listSubscriptions).toHaveBeenLastCalledWith({
        cursor: undefined,
        limit: 20,
        plan: undefined,
      }),
    );
    expect(adminCommercialService.listSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 20 }),
    );
  });

  it('moves change requests forward and back through the returned cursor', async () => {
    render(<AdminChangeRequestsPage />);

    await clickNextAndPrevious();

    await waitFor(() =>
      expect(adminCommercialService.listChangeRequests).toHaveBeenLastCalledWith({
        cursor: 0,
        limit: 50,
        status: 'pending',
        userId: undefined,
      }),
    );
    expect(adminCommercialService.listChangeRequests).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 20 }),
    );
  });
});
