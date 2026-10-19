import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModulePublishersPage from './ModulePublishersPage';

const moduleApps = vi.hoisted(() => ({
  assignPublisher: vi.fn(),
  createPublisher: vi.fn(),
  listPublishers: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  suspendPublisher: vi.fn(),
  verifyPublisher: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const baseUi = vi.hoisted(() => ({ modal: vi.fn(), toastSuccess: vi.fn() }));
const state = vi.hoisted(() => ({
  data: { items: [], nextCursor: null } as { items: any[]; nextCursor: null | string },
  error: undefined as Error | undefined,
  role: 'finance_admin',
}));

vi.mock('@lobechat/types', () => ({
  ADMIN_CAPABILITIES: { financeRead: 'finance.read', moduleAppWrite: 'moduleApp.write' },
  hasAdminCapability: (role: string, capability: string) =>
    role === 'admin' || capability === 'finance.read',
}));
vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: state.role } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
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
  toast: { success: baseUi.toastSuccess },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ModulePublishersPage', () => {
  beforeEach(() => {
    state.data = { items: [], nextCursor: null };
    state.error = undefined;
    state.role = 'finance_admin';
    vi.clearAllMocks();
  });

  it('lets finance readers list publishers but hides every governance control', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/publishers?status=verified&userId=user-1&cursor=cursor-1',
        ]}
      >
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(moduleApps.listPublishers).toHaveBeenCalledWith({
        cursor: 'cursor-1',
        limit: 25,
        status: 'verified',
        userId: 'user-1',
      }),
    );
    expect(screen.getByTestId('module-publishers-page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'moduleApps.admin.publishers.create' })).toBeNull();
    expect(screen.queryByText('moduleApps.admin.publishers.assign')).toBeNull();
    expect(moduleApps.createPublisher).not.toHaveBeenCalled();
    expect(moduleApps.verifyPublisher).not.toHaveBeenCalled();
    expect(moduleApps.suspendPublisher).not.toHaveBeenCalled();
    expect(moduleApps.assignPublisher).not.toHaveBeenCalled();
  });

  it('runs the publisher lifecycle and invalidates only publisher and assigned app data', async () => {
    state.role = 'admin';
    state.data = {
      items: [
        {
          appCount: 0,
          displayName: 'Studio',
          id: 'publisher-1',
          status: 'pending',
          userId: 'user-1',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/publishers']}>
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.create' }));
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.displayName'), {
      target: { value: 'New Studio' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.ownerUserId'), {
      target: { value: 'owner-2' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.create' })[1],
    );
    await waitFor(() =>
      expect(moduleApps.createPublisher).toHaveBeenCalledWith({
        displayName: 'New Studio',
        recipientMask: undefined,
        userId: 'owner-2',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.verify' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.verify' })[1],
    );
    await waitFor(() =>
      expect(moduleApps.verifyPublisher).toHaveBeenCalledWith({
        publisherId: 'publisher-1',
        verificationMetadata: {},
      }),
    );
    const publisherFamilyCall = mocks.mutate.mock.calls.find(
      ([key]) =>
        typeof key === 'function' &&
        key(['admin-module-apps', 'publishers', 'status=pending', 'cursor-1']),
    );
    expect(publisherFamilyCall).toEqual([expect.any(Function), undefined, { revalidate: true }]);
    expect(publisherFamilyCall?.[0](['admin-module-apps', 'apps', '', ''])).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.suspend' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.suspend' })[1],
    );
    await waitFor(() =>
      expect(moduleApps.suspendPublisher).toHaveBeenCalledWith({ publisherId: 'publisher-1' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.assign' }));
    const appId = '00000000-0000-4000-8000-000000000001';
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.appId'), {
      target: { value: appId },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.assign' })[1],
    );
    await waitFor(() =>
      expect(moduleApps.assignPublisher).toHaveBeenCalledWith({
        appId,
        publisherId: 'publisher-1',
      }),
    );
    expect(baseUi.toastSuccess).toHaveBeenCalledWith('moduleApps.admin.publishers.createSuccess');
    expect(baseUi.toastSuccess).toHaveBeenCalledWith('moduleApps.admin.publishers.verifySuccess');
    expect(baseUi.toastSuccess).toHaveBeenCalledWith('moduleApps.admin.publishers.suspendSuccess');
    expect(baseUi.toastSuccess).toHaveBeenCalledWith('moduleApps.admin.publishers.assignSuccess');
    expect(screen.getAllByLabelText('moduleApps.admin.publishers.next')).toHaveLength(1);
    expect(screen.getAllByLabelText('moduleApps.admin.publishers.previous')).toHaveLength(1);
  });

  it('rejects a non-UUID assignment without calling the mutation', () => {
    state.role = 'admin';
    state.data = {
      items: [
        {
          appCount: 0,
          displayName: 'Studio',
          id: 'publisher-1',
          status: 'pending',
          userId: 'user-1',
        },
      ],
      nextCursor: null,
    };

    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/publishers']}>
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.assign' }));
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.appId'), {
      target: { value: 'app-1' },
    });
    expect(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.assign' })[1],
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('moduleApps.admin.publishers.appIdError');
    expect(moduleApps.assignPublisher).not.toHaveBeenCalled();
  });

  it('shows a retryable publisher error and hides governance modals for readers', () => {
    state.error = new Error('temporary failure');
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/publishers']}>
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.retry' }));
    expect(mocks.mutate).toHaveBeenCalledWith(['admin-module-apps', 'publishers', '', '']);
    expect(baseUi.modal).not.toHaveBeenCalled();
  });

  it('exposes create from the initial empty state for writers', () => {
    state.role = 'admin';
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/publishers']}>
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('moduleApps.admin.publishers.emptyTitle')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.create' }),
    ).toHaveLength(1);
  });

  it('invalidates every publisher-list cache family after lifecycle mutations', async () => {
    state.role = 'admin';
    state.data = {
      items: [
        {
          appCount: 0,
          displayName: 'Studio',
          id: 'publisher-1',
          status: 'pending',
          userId: 'user-1',
        },
      ],
      nextCursor: null,
    };
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/publishers']}>
        <ModulePublishersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.verify' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.verify' })[1],
    );
    await waitFor(() => expect(moduleApps.verifyPublisher).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.suspend' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'moduleApps.admin.publishers.suspend' })[1],
    );
    await waitFor(() => expect(moduleApps.suspendPublisher).toHaveBeenCalled());

    const publisherFamilyCalls = mocks.mutate.mock.calls.filter(
      ([key]) =>
        typeof key === 'function' &&
        key(['admin-module-apps', 'publishers', 'status=verified', 'cursor-2']),
    );
    expect(publisherFamilyCalls.length).toBeGreaterThanOrEqual(2);
  });
});
