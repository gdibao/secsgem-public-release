import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';

import { moduleAppCacheKeys } from '../../shared/cacheKeys';
import ModuleAppRuntimePage from './ModuleAppRuntimePage';

const runtimeSettingsFixture = vi.hoisted(() => ({
  blockers: {
    invocation: [],
    publicExecution: [],
    scheduleDispatch: [],
    workflowPrivilegedExecutors: [],
  },
  internalTokenConfigured: true,
  internalTokenMasked: '****oken',
  internalUrl: 'http://module-runtime:3210',
  publicOrigin: 'https://runtime.example.com',
  requestedSwitches: {
    executionEnabled: true,
    invocationEnabled: true,
    publicExecutionEnabled: true,
    scheduleDispatchEnabled: true,
    workflowPrivilegedExecutorsEnabled: true,
  },
  source: { backendManaged: true, legacyEnvironmentKeys: [], values: {} },
  switches: {
    executionEnabled: true,
    invocationEnabled: true,
    publicExecutionEnabled: true,
    scheduleDispatchEnabled: true,
    workflowPrivilegedExecutorsEnabled: true,
  },
}));

const moduleApps = vi.hoisted(() => ({
  dispatchSchedulesNow: vi.fn().mockResolvedValue({
    bookkeepingFailed: 0,
    claimed: 2,
    dispatched: 2,
    failed: 0,
  }),
  getRuntimeDiagnostics: vi.fn().mockResolvedValue({
    configuration: {
      internalTokenConfigured: true,
      internalUrlConfigured: true,
      publicOriginConfigured: true,
    },
    platformGateways: {
      ai: { configured: true, enabledChatModelCount: 2 },
      payments: {
        configured: true,
        enabled: true,
        methods: ['alipay', 'zpay_wechat'],
        moduleAppEnabled: true,
        publicOriginConfigured: true,
        source: { backendManaged: false, legacyEnvironmentKeyCount: 2 },
      },
    },
    probe: { status: 'ready' },
    requestedSwitches: {
      executionEnabled: true,
      invocationEnabled: true,
      publicExecutionEnabled: true,
      scheduleDispatchEnabled: true,
      workflowPrivilegedExecutorsEnabled: true,
    },
    scheduler: {
      activeClaims: 1,
      claimableSchedules: 2,
      enabledSchedules: 4,
      failedScheduledRuns24h: 1,
      lastScheduledRunAt: '2026-07-12T00:30:00.000Z',
      oldestClaimableAt: '2026-07-12T00:00:00.000Z',
      staleClaims: 1,
      status: 'available',
    },
    switches: {
      executionEnabled: true,
      invocationEnabled: true,
      publicExecutionEnabled: true,
      scheduleDispatchEnabled: true,
      workflowPrivilegedExecutorsEnabled: true,
    },
  }),
  listArtifacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listInstalls: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listRecords: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listRuns: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
const getSettingsSection = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const setAppSettingsBatch = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const mutate = vi.hoisted(() => vi.fn());
const confirmModal = vi.hoisted(() => vi.fn());
const runtimeState = vi.hoisted(() => ({
  adminRole: 'admin',
  errorDomain: undefined as string | undefined,
  scheduleDispatchEnabled: false,
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: { getSettingsSection, moduleApps, setAppSettingsBatch },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: runtimeState.adminRole } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));
vi.mock('@/libs/swr', () => ({
  mutate,
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    const parts = Array.isArray(key) ? key : [];
    if (parts[0] === 'admin-settings' && parts[1] === 'section') {
      const error =
        runtimeState.errorDomain === 'settings' ? new Error('settings failed') : undefined;
      return {
        data: error ? undefined : { moduleAppRuntimeConfig: runtimeSettingsFixture },
        error,
        isLoading: false,
      };
    }
    const domain = parts[1] === 'runtime' ? parts[2] : parts[1];
    const error = runtimeState.errorDomain === domain ? new Error(`${domain} failed`) : undefined;
    if (domain === 'diagnostics') {
      return {
        data: error
          ? undefined
          : {
              configuration: {
                internalTokenConfigured: true,
                internalUrlConfigured: true,
                publicOriginConfigured: false,
              },
              platformGateways: {
                ai: { configured: true, enabledChatModelCount: 2 },
                payments: {
                  configured: true,
                  enabled: true,
                  methods: ['alipay', 'zpay_wechat'],
                  moduleAppEnabled: true,
                  publicOriginConfigured: true,
                  source: { backendManaged: false, legacyEnvironmentKeyCount: 2 },
                },
              },
              probe: {
                code: 'MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE',
                status: 'unavailable',
              },
              requestedSwitches: {
                executionEnabled: true,
                invocationEnabled: true,
                publicExecutionEnabled: true,
                scheduleDispatchEnabled: true,
                workflowPrivilegedExecutorsEnabled: true,
              },
              scheduler: {
                activeClaims: 1,
                claimableSchedules: 2,
                enabledSchedules: 4,
                failedScheduledRuns24h: 1,
                lastScheduledRunAt: '2026-07-12T00:30:00.000Z',
                oldestClaimableAt: '2026-07-12T00:00:00.000Z',
                staleClaims: 1,
                status: 'available',
              },
              switches: {
                executionEnabled: false,
                invocationEnabled: false,
                publicExecutionEnabled: false,
                scheduleDispatchEnabled: runtimeState.scheduleDispatchEnabled,
                workflowPrivilegedExecutorsEnabled: false,
              },
            },
        error,
        isLoading: false,
      };
    }
    return {
      data: {
        items: error
          ? []
          : [
              {
                collectionKey: 'records',
                fileName: 'result.md',
                id: `${domain}-1`,
                mimeType: 'text/markdown',
                scopeType: 'personal',
                status: 'succeeded',
                storageKey: 'module-apps/app-1/result.md',
              },
            ],
        nextCursor: null,
      },
      error,
      isLoading: false,
    };
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType = 'button', icon: Icon, loading: _loading, ...props }: any) => (
    <button type={htmlType} {...props}>
      {Icon ? <Icon /> : null}
      {children}
    </button>
  ),
  Switch: ({ checked, onChange, ...props }: any) => (
    <input
      checked={checked}
      type="checkbox"
      {...props}
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
  confirmModal,
  toast,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: string }) =>
      options?.code ? `${key}: ${options.code}` : key,
  }),
}));

describe('ModuleAppRuntimePage', () => {
  beforeEach(() => {
    runtimeState.adminRole = 'admin';
    runtimeState.errorDomain = undefined;
    runtimeState.scheduleDispatchEnabled = false;
    vi.clearAllMocks();
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/apps/app-1/runtime']}>
        <Routes>
          <Route
            element={<ModuleAppRuntimePage />}
            path="/settings/admin/modules/apps/:appId/runtime"
          />
        </Routes>
      </MemoryRouter>,
    );

  it('loads diagnostics and four independent app-scoped runtime sections', async () => {
    renderPage();

    await waitFor(() => {
      expect(moduleApps.listInstalls).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 10,
      });
      expect(moduleApps.listRecords).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 10,
      });
      expect(moduleApps.listRuns).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 10,
      });
      expect(moduleApps.listArtifacts).toHaveBeenCalledWith({
        appId: 'app-1',
        cursor: undefined,
        limit: 10,
      });
      expect(moduleApps.getRuntimeDiagnostics).toHaveBeenCalledOnce();
      expect(getSettingsSection).toHaveBeenCalledWith('module-runtime');
    });

    expect(screen.getByTestId('module-app-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('module-runtime-settings')).toBeInTheDocument();
    const diagnostics = within(screen.getByTestId('module-runtime-diagnostics'));
    expect(diagnostics.getByText('moduleApps.admin.runtime.diagnostics.probe')).toBeInTheDocument();
    expect(diagnostics.getByText(/MODULE_APP_RUNTIME_DOCKER_UNAVAILABLE/)).toBeInTheDocument();
    expect(
      diagnostics.getByText('moduleApps.admin.runtime.diagnostics.managedAiModels'),
    ).toBeInTheDocument();
    expect(
      diagnostics.getByRole('heading', {
        name: 'moduleApps.admin.runtime.diagnostics.schedulerTitle',
      }),
    ).toBeInTheDocument();
    expect(
      diagnostics.getByText('moduleApps.admin.runtime.diagnostics.claimableSchedules'),
    ).toBeInTheDocument();
    expect(
      diagnostics.getByText('moduleApps.admin.runtime.diagnostics.staleClaims'),
    ).toBeInTheDocument();
    expect(
      diagnostics.getByRole('heading', {
        name: 'moduleApps.admin.runtime.diagnostics.platformGatewaysTitle',
      }),
    ).toBeInTheDocument();
    expect(diagnostics.getByText(/moduleApps\.purchase\.methods\.alipay/)).toBeInTheDocument();
    expect(
      diagnostics.getByText('moduleApps.admin.runtime.diagnostics.paymentSource.legacyEnvironment'),
    ).toBeInTheDocument();
    expect(
      diagnostics.getByRole('link', {
        name: 'moduleApps.admin.runtime.diagnostics.manageProviders',
      }),
    ).toHaveAttribute('href', '/settings/admin/providers');
    expect(
      diagnostics.getByRole('link', {
        name: 'moduleApps.admin.runtime.diagnostics.managePayments',
      }),
    ).toHaveAttribute('href', '/settings/admin/payments');
    fireEvent.click(
      diagnostics.getByRole('button', {
        name: 'moduleApps.admin.runtime.diagnostics.refresh',
      }),
    );
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.runtimeDiagnostics());
    expect(screen.getByTestId('module-runtime-installs')).toBeInTheDocument();
    expect(screen.getByTestId('module-runtime-records')).toBeInTheDocument();
    expect(screen.getByTestId('module-runtime-runs')).toBeInTheDocument();
    expect(screen.getByTestId('module-runtime-artifacts')).toBeInTheDocument();

    const installs = within(screen.getByTestId('module-runtime-installs'));
    expect(
      installs.getByRole('columnheader', {
        name: 'moduleApps.admin.operations.installs.columns.install',
      }),
    ).toBeInTheDocument();
    expect(installs.getByRole('link')).toHaveAttribute(
      'href',
      '/settings/admin/modules/operations/installs?appId=app-1',
    );
  });

  it('keeps section errors and retries independent', () => {
    runtimeState.errorDomain = 'runs';
    renderPage();

    expect(
      within(screen.getByTestId('module-runtime-runs')).getByTestId('module-error-state'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('module-runtime-installs')).getByRole('table'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('module-runtime-runs')).getByRole('button', {
        name: 'moduleApps.admin.center.state.retry',
      }),
    );
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.runtime('runs', 'app-1', 10));
  });

  it('keeps backend Runtime settings available when diagnostics fail', () => {
    runtimeState.errorDomain = 'diagnostics';
    renderPage();

    expect(screen.getByTestId('module-runtime-settings')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('module-runtime-diagnostics')).getByTestId('module-error-state'),
    ).toBeInTheDocument();
  });

  it('confirms and audits an immediate global schedule dispatch', async () => {
    runtimeState.scheduleDispatchEnabled = true;
    renderPage();

    fireEvent.click(
      within(screen.getByTestId('module-runtime-diagnostics')).getByRole('button', {
        name: 'moduleApps.admin.runtime.diagnostics.dispatchNow',
      }),
    );
    const [confirmation] = confirmModal.mock.calls[0] as [
      { content: string; onOk: () => Promise<void> },
    ];
    expect(confirmation.content).toBe('moduleApps.admin.runtime.diagnostics.dispatchNowConfirm');

    await confirmation.onOk();

    expect(moduleApps.dispatchSchedulesNow).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.runtimeDiagnostics());
    expect(toast.success).toHaveBeenCalledWith(
      'moduleApps.admin.runtime.diagnostics.dispatchNowSuccess',
    );
  });

  it('persists requested runtime controls through the shared App Settings writer', async () => {
    renderPage();

    expect(
      screen.getByRole('checkbox', {
        name: 'moduleApps.admin.runtime.settings.publicExecution',
      }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'moduleApps.admin.runtime.settings.execution' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.runtime.settings.save' }));

    await waitFor(() => {
      expect(setAppSettingsBatch).toHaveBeenCalledWith({
        updates: expect.arrayContaining([
          { key: 'moduleApp.runtime.execution.enabled', value: false },
          { key: 'moduleApp.runtime.publicExecution.enabled', value: false },
          { key: 'moduleApp.runtime.invocation.enabled', value: false },
          { key: 'moduleApp.runtime.scheduleDispatch.enabled', value: false },
          { key: 'moduleApp.runtime.workflowPrivilegedExecutors.enabled', value: false },
        ]),
      });
    });
    expect(mutate).toHaveBeenCalledWith(ADMIN_SETTINGS_SECTION_SWR_KEY('module-runtime'));
    expect(mutate).toHaveBeenCalledWith(moduleAppCacheKeys.runtimeDiagnostics());
    expect(toast.success).toHaveBeenCalledWith('moduleApps.admin.runtime.settings.saved');
  });

  it('keeps runtime controls read-only without the module write capability', () => {
    runtimeState.adminRole = 'content_admin';
    renderPage();

    const settings = within(screen.getByTestId('module-runtime-settings'));
    for (const control of settings.getAllByRole('checkbox')) expect(control).toBeDisabled();
    for (const name of [
      'moduleApps.admin.runtime.settings.internalUrl',
      'moduleApps.admin.runtime.settings.publicOrigin',
    ]) {
      expect(settings.getByLabelText(name)).toBeDisabled();
    }
    expect(settings.getByPlaceholderText('****oken')).toBeDisabled();
    expect(
      settings.getByRole('button', { name: 'moduleApps.admin.runtime.settings.save' }),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('module-runtime-diagnostics')).queryByRole('button', {
        name: 'moduleApps.admin.runtime.diagnostics.dispatchNow',
      }),
    ).not.toBeInTheDocument();
  });
});
