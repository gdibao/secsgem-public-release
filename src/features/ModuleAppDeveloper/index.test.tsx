import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as m from 'motion/react-m';
import { MemoryRouter } from 'react-router';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAppDeveloper from './index';

const service = vi.hoisted(() => ({
  getMyDeveloperFinance: vi.fn(),
  getMyDeveloperFinanceSummary: vi.fn(),
  getMyPublisherProfile: vi.fn(),
  listMyDeveloperApps: vi.fn(),
  listMyDeveloperPayouts: vi.fn(),
  listMyDeveloperRevenue: vi.fn(),
  listMyDeveloperSubmissions: vi.fn(),
  listMyDeveloperVersions: vi.fn(),
  publishMyDeveloperApp: vi.fn(),
  rollbackMyDeveloperApp: vi.fn(),
  unpublishMyDeveloperApp: vi.fn(),
  upsertMyPublisherProfile: vi.fn(),
}));

vi.mock('@/services/moduleApp', () => ({ moduleAppService: service }));
vi.mock('@/features/ModuleAppMarket/PackageUploader', () => ({
  default: () => <button>moduleApps.packageUploader.submit</button>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderConsole = (search = '') =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ConfigProvider motion={m}>
        <MemoryRouter initialEntries={['/developer' + search]}>
          <ModuleAppDeveloper />
        </MemoryRouter>
      </ConfigProvider>
    </SWRConfig>,
  );

describe('ModuleAppDeveloper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getMyPublisherProfile.mockResolvedValue({
      createdAt: '2026-07-27T00:00:00.000Z',
      displayName: 'Developer Studio',
      id: 'publisher-1',
      status: 'verified',
      updatedAt: '2026-07-27T00:00:00.000Z',
      verifiedAt: '2026-07-27T00:00:00.000Z',
    });
    service.listMyDeveloperApps.mockResolvedValue({
      items: [
        {
          currentPublishedVersion: null,
          displayName: 'Developer App',
          id: 'app-1',
          latestPackage: {
            appDisplayName: 'Developer App',
            appId: 'app-1',
            appSlug: 'developer-app',
            build: { failureCode: null, status: 'ready' },
            createdAt: '2026-07-27T00:00:00.000Z',
            fileName: 'developer-app.zip',
            id: 'package-1',
            packageVersion: '1.0.0',
            publishedAt: null,
            rejectionReason: null,
            reviewStatus: 'approved',
            scanStatus: 'clean',
            validationReport: [],
          },
          latestVersion: {
            id: 'version-1',
            publishedAt: null,
            version: '1.0.0',
          },
          metrics: {
            activeInstallations: 12,
            failedRuns30d: 2,
            successfulRuns30d: 38,
            totalRuns30d: 40,
          },
          slug: 'developer-app',
          status: 'draft',
          updatedAt: '2026-07-27T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    service.listMyDeveloperSubmissions.mockResolvedValue({ items: [], nextCursor: null });
    service.getMyDeveloperFinance.mockResolvedValue({ payouts: [], revenue: [], summary: [] });
    service.getMyDeveloperFinanceSummary.mockResolvedValue([]);
    service.listMyDeveloperPayouts.mockResolvedValue({ items: [], nextCursor: null });
    service.listMyDeveloperRevenue.mockResolvedValue({ items: [], nextCursor: null });
    service.publishMyDeveloperApp.mockResolvedValue({ ok: true });
  });

  it('shows owned app metrics and publishes an approved ready build', async () => {
    renderConsole();

    expect(await screen.findByTestId('module-app-developer-console')).toBeInTheDocument();
    const appRow = screen.getByText('Developer App').closest('article');
    expect(appRow).not.toBeNull();
    expect(within(appRow!).getByText('12')).toBeInTheDocument();
    expect(within(appRow!).getByText('40')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.developer.publish' }));
    await waitFor(() =>
      expect(service.publishMyDeveloperApp).toHaveBeenCalledWith({ appId: 'app-1' }),
    );
  });

  it('keeps suspended publishers in read-only mode', async () => {
    service.getMyPublisherProfile.mockResolvedValue({
      createdAt: '2026-07-27T00:00:00.000Z',
      displayName: 'Suspended Studio',
      id: 'publisher-1',
      status: 'suspended',
      updatedAt: '2026-07-27T00:00:00.000Z',
      verifiedAt: '2026-07-27T00:00:00.000Z',
    });

    renderConsole();

    expect(await screen.findByTestId('module-app-developer-console')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'moduleApps.developer.publish' })).toBeDisabled();
  });

  it('paginates applications without replacing the console shell', async () => {
    service.listMyDeveloperApps
      .mockResolvedValueOnce({ items: [], nextCursor: 20 })
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    renderConsole();

    fireEvent.click(await screen.findByRole('button', { name: 'moduleApps.developer.next' }));
    await waitFor(() =>
      expect(service.listMyDeveloperApps).toHaveBeenLastCalledWith({ cursor: 20, limit: 20 }),
    );
    expect(screen.getByTestId('module-app-developer-console')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'moduleApps.developer.previous' }),
    ).toBeInTheDocument();
  });

  it('isolates an applications error and exposes a local retry action', async () => {
    service.listMyDeveloperApps.mockRejectedValueOnce(new Error('apps unavailable'));

    renderConsole();

    expect(await screen.findByTestId('module-app-developer-console')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('moduleApps.developer.loadError');
    expect(screen.getByRole('button', { name: 'moduleApps.developer.retry' })).toBeInTheDocument();
  });

  it('restores the selected tab from the URL', async () => {
    renderConsole('?tab=packages');

    await waitFor(() =>
      expect(service.listMyDeveloperSubmissions).toHaveBeenCalledWith({ cursor: 0, limit: 20 }),
    );
    expect(service.listMyDeveloperApps).not.toHaveBeenCalled();
  });

  it('paginates revenue and payouts independently', async () => {
    service.listMyDeveloperRevenue.mockImplementation(async ({ cursor }) => ({
      items: [],
      nextCursor: cursor === 0 ? 20 : null,
    }));
    service.listMyDeveloperPayouts.mockImplementation(async ({ cursor }) => ({
      items: [],
      nextCursor: cursor === 0 ? 20 : null,
    }));

    renderConsole('?tab=finance');

    const nextButtons = await screen.findAllByRole('button', {
      name: 'moduleApps.developer.next',
    });
    fireEvent.click(nextButtons[0]!);
    await waitFor(() =>
      expect(service.listMyDeveloperRevenue).toHaveBeenLastCalledWith({ cursor: 20, limit: 20 }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'moduleApps.developer.next' })[1]!);
    await waitFor(() =>
      expect(service.listMyDeveloperPayouts).toHaveBeenLastCalledWith({ cursor: 20, limit: 20 }),
    );
  });
});
