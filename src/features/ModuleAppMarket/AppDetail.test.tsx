import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as m from 'motion/react-m';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppDetail from './AppDetail';

const emptyGrantSnapshot = {
  functionKeys: [],
  outboundHosts: [],
  permissions: [],
  secretKeys: [],
  tableKeys: [],
  workflowKeys: [],
};

const commerceState = vi.hoisted(() => ({
  canManageInstallation: true,
  canManageSecrets: true,
  detailError: undefined as unknown,
  detailLoading: false,
  detailMissing: false,
  detailMutate: vi.fn(),
  installed: false,
  installedVersionId: 'version-1',
  installationReadiness: {
    configuration: 'ready' as 'invalid' | 'ready' | 'required',
    missingSecretCount: 0,
    runtime: 'ready' as 'ready' | 'unavailable',
  },
  licenseData: null as null | { status: string },
  licenseLoading: false,
  licenseMutate: vi.fn(),
  orderStatus: 'pending',
  publishedGrantChange: undefined as any,
  rollbackVersions: [] as Array<{ grantChange?: any; id: string; version: string }>,
  secretKeys: [] as string[],
  updateAvailable: false,
}));

const moduleAppServiceMocks = vi.hoisted(() => ({
  changeInstallationVersion: vi.fn(),
  uninstallPersonal: vi.fn(),
  uninstallWorkspace: vi.fn(),
}));

const baseUiMocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  toast: {
    success: vi.fn(),
  },
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    confirmModal: baseUiMocks.confirmModal,
    toast: baseUiMocks.toast,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <div data-testid="neural-network-loading" />,
}));

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: moduleAppServiceMocks,
}));

vi.mock('swr', () => ({
  default: vi.fn((key: unknown) => {
    const name = Array.isArray(key) ? key[0] : key;
    if (name === 'moduleApp.getDetail') {
      return {
        data: commerceState.detailMissing
          ? undefined
          : {
              actions:
                commerceState.secretKeys.length > 0
                  ? [{ runtimeConfig: { secretKeys: commerceState.secretKeys } }]
                  : [],
              canManageInstallation: commerceState.canManageInstallation,
              canManageInstallationSecrets: commerceState.canManageSecrets,
              category: 'business',
              description: 'Recruitment workflow',
              displayName: 'Recruiting Desk',
              id: 'app-1',
              installed: commerceState.installed,
              installationId: commerceState.installed ? 'installation-1' : undefined,
              installedVersion: commerceState.installed
                ? { id: commerceState.installedVersionId, version: '1.0.0' }
                : undefined,
              installationReadiness: commerceState.installed
                ? commerceState.installationReadiness
                : undefined,
              publishedVersion: commerceState.updateAvailable
                ? {
                    grantChange: commerceState.publishedGrantChange,
                    id: 'version-2',
                    version: '2.0.0',
                  }
                : undefined,
              rollbackVersions: commerceState.rollbackVersions,
              source: 'developer',
              updateAvailable: commerceState.updateAvailable,
              version: '1.0.0',
            },
        error: commerceState.detailError,
        isLoading: commerceState.detailLoading,
        mutate: commerceState.detailMutate,
      };
    }
    if (name === 'moduleApp.listCatalog') {
      return {
        data: [
          {
            amount: 100,
            appId: 'app-1',
            currency: 'CNY',
            licenseScope: 'personal',
            productId: 'product-personal',
            productType: 'one_time',
          },
          {
            amount: 200,
            appId: 'app-1',
            currency: 'CNY',
            licenseScope: 'workspace',
            productId: 'product-team',
            productType: 'one_time',
          },
        ],
        isLoading: false,
      };
    }
    if (name === 'moduleApp.getLicense') {
      return {
        data: commerceState.licenseData,
        isLoading: commerceState.licenseLoading,
        mutate: commerceState.licenseMutate,
      };
    }
    if (name === 'moduleApp.listOrders') {
      return {
        data: [
          { appId: 'app-1', id: 'order-1', status: commerceState.orderStatus, workspaceId: null },
          {
            appId: 'app-1',
            id: 'order-team',
            status: commerceState.orderStatus,
            workspaceId: 'workspace-1',
          },
        ],
        isLoading: false,
        isValidating: false,
        mutate: vi.fn(),
      };
    }
    return { data: undefined, isLoading: false };
  }),
}));

const renderDetail = (entry = '/apps/app-1') =>
  render(
    <ConfigProvider motion={m}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<AppDetail />} path="/apps/:appId" />
        </Routes>
      </MemoryRouter>
    </ConfigProvider>,
  );

vi.mock('./PurchaseModal', () => ({
  default: ({
    catalog,
    open,
    order,
    workspaceId,
  }: {
    catalog: Array<{ licenseScope: string }>;
    open: boolean;
    order?: { id: string };
    workspaceId?: string;
  }) =>
    open ? (
      <div>
        <span>{order?.id}</span>
        <span>{catalog.map((item) => item.licenseScope).join(',')}</span>
        <span>{workspaceId}</span>
      </div>
    ) : null,
}));

vi.mock('./InstallationSecrets', () => ({
  default: ({ installationId, onChange, workspaceId }: Record<string, any>) => (
    <div data-testid="installation-secrets">
      {installationId}:{workspaceId}
      <button onClick={onChange}>refresh-readiness</button>
    </div>
  ),
}));

describe('ModuleAppDetail', () => {
  beforeEach(() => {
    commerceState.canManageInstallation = true;
    commerceState.canManageSecrets = true;
    commerceState.detailError = undefined;
    commerceState.detailLoading = false;
    commerceState.detailMissing = false;
    commerceState.detailMutate.mockReset();
    commerceState.licenseLoading = false;
    commerceState.licenseData = null;
    commerceState.installed = false;
    commerceState.installedVersionId = 'version-1';
    commerceState.installationReadiness = {
      configuration: 'ready',
      missingSecretCount: 0,
      runtime: 'ready',
    };
    commerceState.licenseMutate.mockReset();
    commerceState.orderStatus = 'pending';
    commerceState.publishedGrantChange = undefined;
    commerceState.rollbackVersions = [];
    commerceState.secretKeys = [];
    commerceState.updateAvailable = false;
    moduleAppServiceMocks.changeInstallationVersion
      .mockReset()
      .mockResolvedValue({ changed: true });
    moduleAppServiceMocks.uninstallPersonal.mockReset().mockResolvedValue({ ok: true });
    moduleAppServiceMocks.uninstallWorkspace.mockReset().mockResolvedValue({ ok: true });
    baseUiMocks.confirmModal.mockReset();
    baseUiMocks.toast.success.mockReset();
  });

  it('shows pending payment without presenting the app as licensed', () => {
    renderDetail();

    expect(screen.getByText('Recruiting Desk')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'moduleApps.market.open' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.purchase.pending' }));
    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('personal')).toBeInTheDocument();
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });

  it('uses only team products and orders in a workspace context', () => {
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.purchase.pending' }));
    expect(screen.getByText('order-team')).toBeInTheDocument();
    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(screen.queryByText('personal')).not.toBeInTheDocument();
    expect(screen.getByText('workspace-1')).toBeInTheDocument();
  });

  it('shows open and uninstall actions for an installed workspace app', () => {
    commerceState.installed = true;
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    const open = screen.getByRole('link', { name: 'moduleApps.market.open' });
    const uninstall = screen.getByRole('button', { name: 'moduleApps.market.uninstallRetain' });
    expect(open).toHaveAttribute('data-button-type', 'primary');
    expect(open.compareDocumentPosition(uninstall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('module-app-detail-actions').children).toHaveLength(3);
  });

  it('keeps the app openable while guiding managers to configure missing credentials', () => {
    commerceState.installed = true;
    commerceState.installationReadiness = {
      configuration: 'required',
      missingSecretCount: 2,
      runtime: 'ready',
    };
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    expect(screen.getByRole('link', { name: 'moduleApps.market.open' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'moduleApps.readiness.configurationRequiredManager',
    );
  });

  it('disables opening an installation whose verified runtime is unavailable', () => {
    commerceState.installed = true;
    commerceState.installationReadiness = {
      configuration: 'ready',
      missingSecretCount: 0,
      runtime: 'unavailable',
    };
    renderDetail();

    expect(screen.getByRole('button', { name: 'moduleApps.market.open' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'moduleApps.market.open' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'moduleApps.readiness.runtimeUnavailableDescription',
    );
  });

  it('requires confirmation before uninstalling the current workspace installation', async () => {
    commerceState.installed = true;
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.uninstallRetain' }));

    expect(moduleAppServiceMocks.uninstallWorkspace).not.toHaveBeenCalled();
    expect(baseUiMocks.confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'moduleApps.market.uninstallRetainConfirmContent',
        okButtonProps: { danger: true },
        okText: 'moduleApps.market.uninstallRetain',
        title: 'moduleApps.market.uninstallConfirmTitle',
      }),
    );

    await baseUiMocks.confirmModal.mock.calls[0][0].onOk();

    expect(moduleAppServiceMocks.uninstallWorkspace).toHaveBeenCalledWith({
      appId: 'app-1',
      dataPolicy: 'retain',
      workspaceId: 'workspace-1',
    });
    expect(commerceState.detailMutate).toHaveBeenCalled();
    expect(commerceState.licenseMutate).toHaveBeenCalled();
    expect(baseUiMocks.toast.success).toHaveBeenCalledWith('moduleApps.market.uninstallSuccess');
  });

  it('shows a retryable error when an uninstall request fails', async () => {
    commerceState.installed = true;
    moduleAppServiceMocks.uninstallPersonal.mockRejectedValueOnce(new Error('offline'));
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.uninstallDelete' }));
    await baseUiMocks.confirmModal.mock.calls[0][0].onOk();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('moduleApps.market.uninstallError'),
    );
    expect(baseUiMocks.toast.success).not.toHaveBeenCalled();
  });

  it('updates an installed app with the expected version and workspace scope', async () => {
    commerceState.installed = true;
    commerceState.updateAvailable = true;
    commerceState.rollbackVersions = [{ id: 'version-0', version: '0.9.0' }];
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.update' }));

    await waitFor(() =>
      expect(moduleAppServiceMocks.changeInstallationVersion).toHaveBeenCalledWith({
        acceptedGrantSnapshot: undefined,
        appId: 'app-1',
        expectedVersionId: 'version-1',
        operation: 'upgrade',
        targetVersionId: undefined,
        workspaceId: 'workspace-1',
      }),
    );
    expect(screen.getByRole('button', { name: 'moduleApps.market.rollback' })).toBeInTheDocument();
  });

  it('requires explicit confirmation when an update expands installation grants', async () => {
    commerceState.installed = true;
    commerceState.updateAvailable = true;
    commerceState.publishedGrantChange = {
      added: {
        ...emptyGrantSnapshot,
        outboundHosts: ['api.example.com'],
        permissions: ['records.write'],
      },
      hasExpansion: true,
      targetSnapshot: {
        ...emptyGrantSnapshot,
        outboundHosts: ['api.example.com'],
        permissions: ['records.write'],
      },
    };
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.update' }));
    expect(moduleAppServiceMocks.changeInstallationVersion).not.toHaveBeenCalled();
    expect(baseUiMocks.confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({
        okText: 'moduleApps.market.grantConfirmAction',
        title: 'moduleApps.market.grantConfirmTitle',
      }),
    );

    await baseUiMocks.confirmModal.mock.calls[0][0].onOk();
    expect(moduleAppServiceMocks.changeInstallationVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedGrantSnapshot: commerceState.publishedGrantChange.targetSnapshot,
        operation: 'upgrade',
      }),
    );
  });

  it('keeps workspace installation management read-only for regular members', () => {
    commerceState.canManageInstallation = false;
    commerceState.installed = true;
    commerceState.updateAvailable = true;
    commerceState.rollbackVersions = [{ id: 'version-0', version: '0.9.0' }];
    renderDetail('/apps/app-1?workspaceId=workspace-1');

    expect(screen.getByRole('link', { name: 'moduleApps.market.open' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'moduleApps.market.update' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'moduleApps.market.rollback' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'moduleApps.market.uninstallRetain' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'moduleApps.market.uninstallDelete' }),
    ).not.toBeInTheDocument();
  });

  it('shows install as the only primary action for licensed apps that are not installed', () => {
    commerceState.licenseData = { status: 'active' };

    renderDetail();

    const install = screen.getByRole('button', { name: 'moduleApps.purchase.install' });
    expect(install).toHaveAttribute('data-button-type', 'primary');
    expect(screen.getByTestId('module-app-detail-actions').children).toHaveLength(1);
  });

  it('loads authoritative installation credentials for the active installation scope', () => {
    commerceState.installed = true;
    commerceState.secretKeys = ['CRM_TOKEN', 'CRM_TOKEN', 'API_KEY'];

    renderDetail('/apps/app-1?workspaceId=workspace-1');

    expect(screen.getByTestId('installation-secrets')).toHaveTextContent(
      'installation-1:workspace-1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'refresh-readiness' }));
    expect(commerceState.detailMutate).toHaveBeenCalled();
  });

  it('does not expose shared installation credentials to workspace members without permission', () => {
    commerceState.canManageSecrets = false;
    commerceState.installed = true;
    commerceState.secretKeys = ['CRM_TOKEN'];

    renderDetail('/apps/app-1?workspaceId=workspace-1');

    expect(screen.queryByTestId('installation-secrets')).not.toBeInTheDocument();
  });

  it('renders a semantic responsive metadata list', () => {
    renderDetail();

    const metadata = screen.getByTestId('module-app-detail-metadata');
    expect(metadata.tagName).toBe('DL');
    expect(metadata).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
    expect(screen.getAllByTestId('module-app-detail-metadata-item')).toHaveLength(4);
    expect(metadata).toHaveTextContent('developer');
    expect(metadata).toHaveTextContent('1.0.0');
  });

  it('uses the shared loading state while detail data is loading', () => {
    commerceState.detailLoading = true;
    commerceState.detailMissing = true;

    renderDetail();

    expect(screen.getByRole('status', { name: 'moduleApps.market.loading' })).toBeInTheDocument();
    expect(screen.getByTestId('neural-network-loading')).toBeInTheDocument();
  });

  it('renders a retryable detail error without clearing other commerce state', () => {
    commerceState.detailError = new Error('offline');
    commerceState.detailMissing = true;

    renderDetail();

    expect(screen.getByTestId('mobile-state-view')).toHaveAttribute('data-variant', 'error');
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.retry' }));
    expect(commerceState.detailMutate).toHaveBeenCalled();
  });

  it('blocks checkout while commerce state is loading', () => {
    commerceState.licenseLoading = true;
    renderDetail();

    expect(screen.getByRole('button', { name: /moduleApps\.purchase\.pending/ })).toBeDisabled();
  });

  it('refreshes the license after an order becomes paid', async () => {
    commerceState.orderStatus = 'paid';
    renderDetail();

    await waitFor(() => expect(commerceState.licenseMutate).toHaveBeenCalled());
  });
});
