import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleDraftScope, loadModuleDraft } from '../../shared/draftStorage';
import ModuleAppEntitlementsPage from './ModuleAppEntitlementsPage';

const { billing, entitlements, moduleApps, refresh, roleState, translate } = vi.hoisted(() => ({
  billing: {
    chargeMode: 'free',
    defaultMultiplier: 1,
    externalApiCostCredits: 0,
    failureFixedFeePolicy: 'do_not_charge',
    fixedServiceFeeCredits: 0,
  },
  entitlements: [
    {
      discountPercent: 0,
      freeQuotaCredits: 10,
      installable: true,
      plan: 'pro',
      runnable: true,
      visible: true,
    },
  ],
  moduleApps: {
    upsertBilling: vi.fn().mockResolvedValue(undefined),
    upsertEntitlements: vi.fn().mockResolvedValue(undefined),
  },
  refresh: vi.fn().mockResolvedValue(undefined),
  roleState: { canWrite: true },
  translate: (key: string, values?: Record<string, string>) =>
    ({
      'moduleApps.admin.entitlements.add': 'Add entitlement',
      'moduleApps.admin.entitlements.billing': 'Billing',
      'moduleApps.admin.entitlements.draftRejected': 'Draft could not be stored.',
      'moduleApps.admin.entitlements.draftRestored':
        'Your saved entitlement draft was restored. Saving again reapplies Entitlements and Billing.',
      'moduleApps.admin.entitlements.entitlements': 'Plan entitlements',
      'moduleApps.admin.entitlements.partialSave': `Saved: ${values?.accepted}. Not saved: ${values?.failed}. Your full draft is still available.`,
      'moduleApps.admin.entitlements.save': 'Save entitlements',
      'moduleApps.admin.entitlements.saved': 'Entitlements saved',
      'moduleApps.admin.entitlements.remove': 'Remove entitlement',
      'moduleApps.admin.entitlements.title': 'Entitlements',
    })[key] ?? key,
}));

vi.mock('react-router', () => ({
  useOutletContext: () => ({
    app: {
      actions: [],
      appType: 'standard_app',
      billing,
      category: 'Operations',
      description: 'Manage records',
      displayName: 'Records',
      entitlements,
      icon: 'Blocks',
      id: 'app-1',
      pages: [],
      slug: 'records',
      status: 'draft',
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
  Switch: (props: any) => <input type="checkbox" {...props} />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

describe('ModuleAppEntitlementsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(
      {},
      '',
      '/settings/admin/modules/apps/app-1/entitlements?view=plans',
    );
    roleState.canWrite = true;
    moduleApps.upsertBilling.mockReset().mockResolvedValue(undefined);
    moduleApps.upsertEntitlements.mockReset().mockResolvedValue(undefined);
    refresh.mockReset().mockResolvedValue(undefined);
  });

  it('saves only entitlements and billing when finance write is available', async () => {
    render(<ModuleAppEntitlementsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save entitlements' }));

    await waitFor(() =>
      expect(moduleApps.upsertEntitlements).toHaveBeenCalledWith({ appId: 'app-1', entitlements }),
    );
    expect(moduleApps.upsertBilling).toHaveBeenCalledWith({ appId: 'app-1', billing });
  });

  it('stops entitlement mutations when the complete draft cannot be stored', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    try {
      render(<ModuleAppEntitlementsPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Save entitlements' }));

      expect(await screen.findByText('Draft could not be stored.')).toBeInTheDocument();
      expect(moduleApps.upsertEntitlements).not.toHaveBeenCalled();
      expect(moduleApps.upsertBilling).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it('retains the complete draft and reports a partial save until a retry fully succeeds', async () => {
    moduleApps.upsertBilling.mockRejectedValueOnce(new Error('billing unavailable'));
    const originalUrl = window.location.href;
    const draftScope = createModuleDraftScope('app-1', 'entitlements');
    const { unmount } = render(<ModuleAppEntitlementsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save entitlements' }));

    expect(
      await screen.findByText(
        'Saved: Plan entitlements. Not saved: Billing. Your full draft is still available.',
      ),
    ).toBeInTheDocument();
    expect(loadModuleDraft(draftScope)).toMatchObject({ billing, entitlements });
    expect(window.location.href).toBe(originalUrl);
    expect(refresh).not.toHaveBeenCalled();

    unmount();
    render(<ModuleAppEntitlementsPage />);
    expect(screen.getByDisplayValue('pro')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your saved entitlement draft was restored. Saving again reapplies Entitlements and Billing.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save entitlements' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(moduleApps.upsertEntitlements).toHaveBeenCalledTimes(2);
    expect(moduleApps.upsertBilling).toHaveBeenCalledTimes(2);
    expect(loadModuleDraft(draftScope)).toBeNull();
    expect(screen.getByText('Entitlements saved')).toBeInTheDocument();
    expect(window.location.href).toBe(originalUrl);
  });

  it('continues to billing and reports it accepted when entitlements fail first', async () => {
    moduleApps.upsertEntitlements.mockRejectedValueOnce(new Error('entitlements unavailable'));
    render(<ModuleAppEntitlementsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save entitlements' }));

    expect(
      await screen.findByText(
        'Saved: Billing. Not saved: Plan entitlements. Your full draft is still available.',
      ),
    ).toBeInTheDocument();
    expect(moduleApps.upsertEntitlements).toHaveBeenCalledTimes(1);
    expect(moduleApps.upsertBilling).toHaveBeenCalledTimes(1);
    expect(loadModuleDraft(createModuleDraftScope('app-1', 'entitlements'))).toMatchObject({
      billing,
      entitlements,
    });
  });

  it('disables entitlement controls and ignores read-only events without finance write', () => {
    roleState.canWrite = false;
    const draftScope = createModuleDraftScope('app-1', 'entitlements');

    render(<ModuleAppEntitlementsPage />);

    expect(screen.getByDisplayValue('pro')).toBeDisabled();
    screen.getAllByRole('checkbox').forEach((control) => expect(control).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add entitlement' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove entitlement' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add entitlement' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(screen.getAllByDisplayValue('pro')).toHaveLength(1);
    expect(loadModuleDraft(draftScope)).toBeNull();
    expect(screen.getByText('Plan entitlements')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save entitlements' })).not.toBeInTheDocument();
    expect(moduleApps.upsertEntitlements).not.toHaveBeenCalled();
    expect(moduleApps.upsertBilling).not.toHaveBeenCalled();
  });
});
