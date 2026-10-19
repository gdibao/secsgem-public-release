import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleReviewsPage from './ModuleReviewsPage';

const moduleApps = vi.hoisted(() => ({
  approvePackage: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listPackages: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  rejectPackage: vi.fn(),
  rescanPackage: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const state = vi.hoisted(() => ({
  data: { items: [], nextCursor: null } as { items: any[]; nextCursor: null | string },
  error: undefined as Error | undefined,
  role: 'admin',
}));
const baseUi = vi.hoisted(() => ({ modal: vi.fn() }));

vi.mock('@lobechat/types', () => ({
  ADMIN_CAPABILITIES: { moduleAppWrite: 'moduleApp.write' },
  hasAdminCapability: (role: string, capability: string) =>
    role === 'admin' && capability === 'moduleApp.write',
}));
vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (store: { user: { role: string } }) => unknown) =>
    selector({ user: { role: state.role } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (store: { user: unknown }) => store.user },
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
  Modal: (props: any) => {
    baseUi.modal(props);
    return props.open ? (
      <div>
        {props.children}
        <button disabled={props.okButtonProps?.disabled} type="button" onClick={props.onOk}>
          {props.okText}
        </button>
      </div>
    ) : null;
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModuleReviewsPage', () => {
  beforeEach(() => {
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
    state.role = 'admin';
    vi.clearAllMocks();
  });

  it('uses only package data and restores review filters and cursor from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/reviews?reviewStatus=rejected&buildStatus=failed&appId=app-1&publisherId=publisher-1&submittedByUserId=user-1&cursor=cursor-1',
        ]}
      >
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listPackages).toHaveBeenCalledWith({
        appId: 'app-1',
        buildStatus: 'failed',
        cursor: 'cursor-1',
        limit: 25,
        publisherId: 'publisher-1',
        reviewStatus: 'rejected',
        submittedByUserId: 'user-1',
      }),
    );
    expect(moduleApps.get).not.toHaveBeenCalled();
    expect(moduleApps.list).not.toHaveBeenCalled();
    expect(screen.getByTestId('module-reviews-page')).toBeInTheDocument();
  });

  it('requires a rejection reason before rejecting a pending package', async () => {
    state.role = 'admin';
    state.data = {
      items: [
        {
          buildStatus: 'ready',
          id: 'package-1',
          manifestSnapshot: { app: { displayName: 'Review target' }, packageVersion: '1.0.0' },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
          submittedByUserId: 'user-1',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.reviews.reject' }));
    expect(screen.getByLabelText('moduleApps.admin.reviews.rejectReason')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'moduleApps.admin.reviews.confirmRejection' }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText('moduleApps.admin.reviews.rejectReason'), {
      target: { value: 'Manifest fails policy.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.reviews.confirmRejection' }),
    );

    await waitFor(() =>
      expect(moduleApps.rejectPackage).toHaveBeenCalledWith({
        packageId: 'package-1',
        reason: 'Manifest fails policy.',
      }),
    );
  });

  it('hides package governance controls without module-app-write', () => {
    state.role = 'module_admin';
    state.data = {
      items: [
        {
          buildStatus: 'ready',
          id: 'package-read-only',
          manifestSnapshot: { app: { displayName: 'Read only package' } },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText('moduleApps.admin.reviews.columns.actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.reviews.approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.reviews.reject' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.reviews.rescan' })).toBeNull();
  });

  it('invalidates the authoritative application detail returned by approval', async () => {
    const approvedAppId = '00000000-0000-4000-8000-000000000001';
    state.role = 'admin';
    state.data = {
      items: [
        {
          appId: null,
          buildStatus: 'ready',
          id: '00000000-0000-4000-8000-000000000011',
          manifestSnapshot: { app: { displayName: 'New package' } },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
        },
      ],
      nextCursor: null,
    };
    moduleApps.approvePackage.mockResolvedValueOnce({ appId: approvedAppId });

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.reviews.approve' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'moduleApps.admin.reviews.approve' })[1]);

    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(['admin-module-apps', 'detail', approvedAppId]),
    );
    expect(
      mocks.mutate.mock.calls.some(
        ([key]) =>
          typeof key === 'function' &&
          key(['admin-module-apps', 'apps', 'filters', 'cursor']) === true,
      ),
    ).toBe(true);
  });

  it('requires an administrator classification for every outbound host before approval', async () => {
    state.role = 'admin';
    state.data = {
      items: [
        {
          buildStatus: 'ready',
          id: '00000000-0000-4000-8000-000000000011',
          manifestSnapshot: {
            app: { displayName: 'Network package' },
            runtime: {
              outboundHosts: ['api.example.com', 'models.example.com'],
            },
          },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
        },
      ],
      nextCursor: null,
    };
    moduleApps.approvePackage.mockResolvedValueOnce({
      appId: '00000000-0000-4000-8000-000000000001',
    });

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.reviews.approve' }));
    const confirm = screen.getAllByRole('button', {
      name: 'moduleApps.admin.reviews.approve',
    })[1];
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('api.example.com'), { target: { value: 'general' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('models.example.com'), { target: { value: 'ai' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(moduleApps.approvePackage).toHaveBeenCalledWith({
        outboundHostPolicies: [
          { host: 'api.example.com', purpose: 'general' },
          { host: 'models.example.com', purpose: 'ai' },
        ],
        packageId: '00000000-0000-4000-8000-000000000011',
      }),
    );
  });

  it('does not mount the governance modal for a read-only role', () => {
    state.role = 'module_admin';
    state.data = {
      items: [
        {
          buildStatus: 'ready',
          id: 'package-read-only',
          manifestSnapshot: { app: { displayName: 'Read only package' } },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    expect(baseUi.modal).not.toHaveBeenCalled();
  });

  it('localizes package statuses and provides a retryable domain empty state', () => {
    state.data = {
      items: [
        {
          buildStatus: 'ready',
          id: 'package-2',
          manifestSnapshot: { app: { displayName: 'Status target' } },
          reviewStatus: 'pending_review',
          scanStatus: 'clean',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByText('moduleApps.admin.reviews.status.pendingReview')[0],
    ).toBeInTheDocument();
    expect(screen.getByText('moduleApps.admin.reviews.scanStatus.clean')).toBeInTheDocument();
    expect(screen.queryByText('pending_review')).toBeNull();
    expect(screen.queryByText('clean')).toBeNull();

    state.data = { items: [], nextCursor: null };
    const { unmount } = render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews?reviewStatus=approved']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('moduleApps.admin.reviews.filteredEmptyTitle')).toBeInTheDocument();
    unmount();

    state.error = new Error('temporary failure');
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/reviews']}>
        <ModuleReviewsPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.reviews.retry' }));
    expect(mocks.mutate).toHaveBeenCalledWith(['admin-module-apps', 'packages', '', '']);
  });
});
