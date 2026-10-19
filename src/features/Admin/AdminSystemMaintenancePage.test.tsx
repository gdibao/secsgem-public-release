import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminCommercialService } from '@/services/adminCommercial';

import AdminSystemMaintenancePage from './AdminSystemMaintenancePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./AdminDangerousActionButton', () => ({
  default: ({
    children,
    onConfirm,
  }: {
    children?: ReactNode;
    onConfirm: (command: {
      actionId: 'setting.runMaintenance';
      confirmed: true;
    }) => Promise<void> | void;
  }) => (
    <button onClick={() => void onConfirm({ actionId: 'setting.runMaintenance', confirmed: true })}>
      {children}
    </button>
  ),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({
    data: {
      cronAuditRetentionDays: 365,
      cronPendingOrderExpiryDays: 7,
      sharedHealth: {},
    },
    isLoading: false,
  })),
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    getSettingsSection: vi.fn(),
    refreshRuntimeCaches: vi.fn(),
    runMaintenance: vi.fn(),
    setAppSettingsBatch: vi.fn(),
  },
}));

describe('AdminSystemMaintenancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminCommercialService.runMaintenance).mockResolvedValue({
      moduleAppUploadCleanupFailed: 1,
      moduleAppUploadsExpired: 2,
      ok: true,
    } as any);
  });

  it('shows module app cleanup counts in the maintenance result', async () => {
    render(
      <ConfigProvider motion={m}>
        <AdminSystemMaintenancePage />
      </ConfigProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'admin.maintenance.runNow' }));

    await waitFor(() => {
      expect(adminCommercialService.runMaintenance).toHaveBeenCalledWith({
        actionId: 'setting.runMaintenance',
        confirmed: true,
      });
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('已清理模块应用上传')).toBeInTheDocument();
    expect(within(dialog).getByText('模块应用上传清理失败')).toBeInTheDocument();
    expect(within(dialog).getByText('2')).toBeInTheDocument();
    expect(within(dialog).getByText('1')).toBeInTheDocument();
  });
});
