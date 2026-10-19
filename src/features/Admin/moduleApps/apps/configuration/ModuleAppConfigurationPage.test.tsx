import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleDraftScope, loadModuleDraft } from '../../shared/draftStorage';
import ModuleAppConfigurationPage from './ModuleAppConfigurationPage';

const { actions, appPages, moduleApps, pages, refresh, roleState, translate } = vi.hoisted(() => ({
  actions: [
    {
      id: 'archive_records',
      inputSchema: { fields: [] },
      moduleMultiplier: 1,
      name: 'Archive records',
      outputSchema: {},
      runtimeConfig: { functionKey: 'archive_records' },
      runtimeType: 'executable_action',
    },
  ],
  appPages: { current: undefined as unknown[] | undefined },
  moduleApps: {
    upsertBilling: vi.fn(),
    upsertConfiguration: vi.fn().mockResolvedValue(undefined),
    upsertEntitlements: vi.fn(),
  },
  pages: [
    {
      actionBindings: [],
      dataSource: {},
      key: 'overview',
      layoutSchema: {},
      routePath: '/',
      sortOrder: 0,
      title: 'Overview',
      type: 'overview',
    },
  ],
  refresh: vi.fn().mockResolvedValue(undefined),
  roleState: { canWrite: true },
  translate: (key: string, _values?: Record<string, string>) =>
    ({
      'moduleApps.admin.configuration.actions': 'Actions',
      'moduleApps.admin.configuration.addAction': 'Add action',
      'moduleApps.admin.configuration.addPage': 'Add page',
      'moduleApps.admin.configuration.draftRejected': 'Draft could not be stored.',
      'moduleApps.admin.configuration.draftRestored':
        'Your saved configuration draft was restored. Saving again reapplies Pages and Actions.',
      'moduleApps.admin.configuration.conflict':
        'This configuration changed elsewhere. Refresh before retrying; your draft is still available.',
      'moduleApps.admin.configuration.pages': 'Pages',
      'moduleApps.admin.configuration.save': 'Save configuration',
      'moduleApps.admin.configuration.saveFailed':
        'Configuration was not saved. Your full draft is still available.',
      'moduleApps.admin.configuration.saved': 'Configuration saved',
      'moduleApps.admin.configuration.removeAction': 'Remove action',
      'moduleApps.admin.configuration.removePage': 'Remove page',
      'moduleApps.admin.configuration.title': 'Configuration',
      'moduleApps.admin.configuration.validationError': 'Review the JSON fields and try again.',
    })[key] ?? key,
}));

vi.mock('react-router', () => ({
  useOutletContext: () => ({
    app: {
      actions,
      appType: 'standard_app',
      billing: { chargeMode: 'free', defaultMultiplier: 1 },
      category: 'Operations',
      description: 'Manage records',
      displayName: 'Records',
      entitlements: [],
      icon: 'Blocks',
      id: 'app-1',
      pages: appPages.current ?? pages,
      slug: 'records',
      status: 'draft',
      versionId: 'version-1',
    },
    refresh,
  }),
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: { moduleApps },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: () => ({ role: 'admin' }) },
}));
vi.mock('@lobechat/types', async (importOriginal) => ({
  ...(await importOriginal()),
  hasAdminCapability: () => roleState.canWrite,
}));
vi.mock('../../../shared/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: vi.fn() }));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    danger: _danger,
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
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

describe('ModuleAppConfigurationPage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(
      {},
      '',
      '/settings/admin/modules/apps/app-1/configuration?tab=advanced',
    );
    moduleApps.upsertBilling.mockReset();
    moduleApps.upsertConfiguration.mockReset().mockResolvedValue(undefined);
    moduleApps.upsertEntitlements.mockReset();
    refresh.mockReset().mockResolvedValue(undefined);
    appPages.current = undefined;
    roleState.canWrite = true;
  });

  it('preserves an explicitly empty initial pages configuration', () => {
    appPages.current = [];

    render(<ModuleAppConfigurationPage />);

    expect(
      screen.queryByLabelText('moduleApps.admin.configuration.pageKey'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add page' })).toBeEnabled();
  });

  it('sends an empty pages array after removing the final page', async () => {
    render(<ModuleAppConfigurationPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));
    expect(
      screen.queryByLabelText('moduleApps.admin.configuration.pageKey'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() =>
      expect(moduleApps.upsertConfiguration).toHaveBeenCalledWith({
        actions,
        appId: 'app-1',
        expectedVersionId: 'version-1',
        pages: [],
      }),
    );
  });

  it('disables configuration list controls and ignores read-only events', async () => {
    roleState.canWrite = false;
    const draftScope = createModuleDraftScope('app-1', 'configuration');

    render(<ModuleAppConfigurationPage />);

    const listButtons = [
      screen.getByRole('button', { name: 'Add page' }),
      screen.getByRole('button', { name: 'Remove page' }),
      screen.getByRole('button', { name: 'Add action' }),
      screen.getByRole('button', { name: 'Remove action' }),
    ];
    listButtons.forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove action' }));

    expect(screen.getAllByLabelText('moduleApps.admin.configuration.pageKey')).toHaveLength(1);
    expect(screen.getAllByLabelText('moduleApps.admin.configuration.actionId')).toHaveLength(1);
    expect(loadModuleDraft(draftScope)).toBeNull();
    expect(moduleApps.upsertConfiguration).not.toHaveBeenCalled();
  });

  it('saves only pages and actions for the outlet application', async () => {
    render(<ModuleAppConfigurationPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() =>
      expect(moduleApps.upsertConfiguration).toHaveBeenCalledWith({
        actions,
        appId: 'app-1',
        expectedVersionId: 'version-1',
        pages,
      }),
    );
    expect(moduleApps.upsertConfiguration).toHaveBeenCalledTimes(1);
    expect(moduleApps.upsertEntitlements).not.toHaveBeenCalled();
    expect(moduleApps.upsertBilling).not.toHaveBeenCalled();
  });

  it('stops configuration mutations when the complete draft cannot be stored', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    try {
      render(<ModuleAppConfigurationPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

      expect(await screen.findByText('Draft could not be stored.')).toBeInTheDocument();
      expect(moduleApps.upsertConfiguration).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it('retains the complete draft when the atomic save fails until a retry succeeds', async () => {
    moduleApps.upsertConfiguration.mockRejectedValueOnce(new Error('configuration unavailable'));
    const originalUrl = window.location.href;
    const draftScope = createModuleDraftScope('app-1', 'configuration');
    const { unmount } = render(<ModuleAppConfigurationPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(
      await screen.findByText('Configuration was not saved. Your full draft is still available.'),
    ).toBeInTheDocument();
    expect(loadModuleDraft(draftScope)).toEqual({
      actions: [
        expect.objectContaining({
          id: 'archive_records',
          inputSchema: { fields: [] },
          inputSchemaJson: expect.stringContaining('"fields"'),
          runtimeConfig: { functionKey: 'archive_records' },
          runtimeConfigJson: expect.stringContaining('"functionKey": "archive_records"'),
          runtimeType: 'executable_action',
        }),
      ],
      pages: [
        expect.objectContaining({
          actionBindings: [],
          actionBindingsJson: '',
          dataSource: {},
          dataSourceJson: '',
          key: 'overview',
          layoutSchema: {},
          layoutSchemaJson: '',
          routePath: '/',
        }),
      ],
    });
    expect(window.location.href).toBe(originalUrl);
    expect(refresh).not.toHaveBeenCalled();

    unmount();
    render(<ModuleAppConfigurationPage />);
    expect(screen.getByDisplayValue('archive_records')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your saved configuration draft was restored. Saving again reapplies Pages and Actions.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(moduleApps.upsertConfiguration).toHaveBeenCalledTimes(2);
    expect(moduleApps.upsertConfiguration).toHaveBeenLastCalledWith({
      actions,
      appId: 'app-1',
      expectedVersionId: 'version-1',
      pages,
    });
    expect(loadModuleDraft(draftScope)).toBeNull();
    expect(screen.getByText('Configuration saved')).toBeInTheDocument();
    expect(window.location.href).toBe(originalUrl);
  });

  it('does not persist sensitive identifiers embedded in action runtime JSON', async () => {
    const draftScope = createModuleDraftScope('app-1', 'configuration');
    render(<ModuleAppConfigurationPage />);

    fireEvent.change(screen.getByLabelText('moduleApps.admin.configuration.runtimeConfigJson'), {
      target: { value: '{"paymentRecipientId":"recipient-1"}' },
    });

    await waitFor(() => expect(loadModuleDraft(draftScope)).toBeNull());
  });

  it('shows localized validation feedback without mutating when action JSON is invalid', async () => {
    render(<ModuleAppConfigurationPage />);
    fireEvent.change(screen.getByLabelText('moduleApps.admin.configuration.runtimeConfigJson'), {
      target: { value: '{invalid' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(await screen.findByText('Review the JSON fields and try again.')).toBeInTheDocument();
    expect(moduleApps.upsertConfiguration).not.toHaveBeenCalled();
  });
});
