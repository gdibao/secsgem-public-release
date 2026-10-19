import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProductManager from './ProductManager';
import { moduleAppCacheKeys } from './shared/cacheKeys';

const { mutate, retry, swrState } = vi.hoisted(() => ({
  mutate: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn().mockResolvedValue(undefined),
  swrState: {
    data: [] as any[],
    error: undefined as unknown,
    isLoading: false,
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate,
  useClientDataSWR: vi.fn(() => ({
    ...swrState,
    mutate: retry,
  })),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    block: _block,
    htmlType,
    icon: _icon,
    loading: _loading,
    type: _type,
    ...props
  }: any) => (
    <button type={htmlType} {...props}>
      {children}
    </button>
  ),
  Modal: ({ children, open }: any) => (open ? <div>{children}</div> : null),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'moduleApps.admin.products.add': 'Add product',
        'moduleApps.admin.products.amount': 'Amount',
        'moduleApps.admin.products.currency': 'Currency',
        'moduleApps.admin.products.edit': 'Edit product',
        'moduleApps.admin.products.emptyDescription': 'Create a product to set its pricing.',
        'moduleApps.admin.products.emptyTitle': 'No products',
        'moduleApps.admin.products.loadErrorDescription': 'Try loading the products again.',
        'moduleApps.admin.products.loadErrorTitle': 'Products could not be loaded',
        'moduleApps.admin.products.loading': 'Loading products',
        'moduleApps.admin.products.moduleMultiplier': 'Module multiplier',
        'moduleApps.admin.products.productKey': 'Product key',
        'moduleApps.admin.products.promotionTitle': 'Promotion title',
        'moduleApps.admin.products.revenueShareRate': 'Revenue share rate',
        'moduleApps.admin.products.retry': 'Retry',
        'moduleApps.admin.products.save': 'Save product',
        'moduleApps.admin.products.seatCount': 'Seat count',
        'moduleApps.admin.products.termsVersion': 'Terms version',
        'moduleApps.admin.products.trialDays': 'Trial days',
      })[key] ?? key,
  }),
}));

describe('ProductManager', () => {
  beforeEach(() => {
    mutate.mockClear();
    retry.mockClear();
    swrState.data = [
      {
        amount: 88,
        currency: 'CNY',
        licenseScope: 'personal',
        productId: 'product-1',
        productKey: 'pro',
        productType: 'one_time',
        status: 'active',
      },
    ];
    swrState.error = undefined;
    swrState.isLoading = false;
  });

  it('shows a product loading state without rendering a table spinner', () => {
    swrState.data = [];
    swrState.isLoading = true;

    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{ createProduct: vi.fn(), listProducts: vi.fn(), updateProduct: vi.fn() }}
      />,
    );

    expect(screen.getByTestId('module-list-skeleton')).toHaveAccessibleName('Loading products');
    expect(document.querySelector('.ant-spin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument();
  });

  it('shows a product error state and retries the bound request', () => {
    swrState.data = [];
    swrState.error = new Error('network');

    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{ createProduct: vi.fn(), listProducts: vi.fn(), updateProduct: vi.fn() }}
      />,
    );

    expect(screen.getByText('Products could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows one writable product action in the initial empty state', () => {
    swrState.data = [];

    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{ createProduct: vi.fn(), listProducts: vi.fn(), updateProduct: vi.fn() }}
      />,
    );

    expect(screen.getByTestId('module-empty-initial')).toHaveTextContent('No products');
    expect(screen.getAllByRole('button', { name: 'Add product' })).toHaveLength(1);
  });

  it('keeps products readable while disabling mutations without module app write', () => {
    const createProduct = vi.fn();
    const updateProduct = vi.fn();
    render(
      <ProductManager
        appId="app-1"
        canWrite={false}
        service={{ createProduct, listProducts: vi.fn(), updateProduct }}
      />,
    );

    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit product' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));

    expect(screen.queryByLabelText('Product key')).not.toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('lists products and creates a server-priced product', async () => {
    const createProduct = vi.fn().mockResolvedValue({ id: 'product-2' });
    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{
          createProduct,
          listProducts: vi.fn(),
          updateProduct: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByText('CNY 88')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product key'), { target: { value: 'team-pro' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Module multiplier'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('Revenue share rate'), { target: { value: '0.75' } });
    fireEvent.change(screen.getByLabelText('Seat count'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Terms version'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));

    await waitFor(() =>
      expect(createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'app-1',
          moduleMultiplier: '1.25',
          price: expect.objectContaining({ amount: 120, currency: 'CNY' }),
          productKey: 'team-pro',
          revenueShareRate: '0.75',
          seatCount: 12,
          termsVersion: '2026-07',
        }),
      ),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.products('app-1'));
  });

  it('updates a product and invalidates only its application products key', async () => {
    const updateProduct = vi.fn().mockResolvedValue({ id: 'product-1' });
    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{
          createProduct: vi.fn(),
          listProducts: vi.fn(),
          updateProduct,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));

    await waitFor(() =>
      expect(updateProduct).toHaveBeenCalledWith({
        licenseScope: 'personal',
        moduleMultiplier: '1',
        price: { amount: 99, currency: 'CNY', trialDays: 0 },
        productId: 'product-1',
        productType: 'one_time',
        revenueShareRate: '0',
        seatCount: undefined,
        status: 'active',
        termsVersion: '1',
      }),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.products('app-1'));
  });

  it('matches the server product limits in the form controls', () => {
    render(
      <ProductManager
        canWrite
        appId="app-1"
        service={{
          createProduct: vi.fn(),
          listProducts: vi.fn(),
          updateProduct: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    expect(screen.getByLabelText('Amount')).toHaveAttribute('step', '1');
    expect(screen.getByLabelText('Currency')).toHaveAttribute('role', 'combobox');
    expect(screen.getByLabelText('Trial days')).toHaveAttribute('aria-valuemax', '365');
    expect(screen.getByLabelText('Promotion title')).toHaveAttribute('maxlength', '160');
  });
});
