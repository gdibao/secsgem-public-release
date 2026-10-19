import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import * as m from 'motion/react-m';
import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppMyAppsView } from './MyAppsOverview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PackageUploader', () => ({
  default: ({ onSubmitted }: { onSubmitted?: () => void }) => (
    <button onClick={onSubmitted}>moduleApps.packageUploader.submit</button>
  ),
}));

const renderView = (ui: ReactElement) =>
  render(
    <ConfigProvider motion={m}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ConfigProvider>,
  );

describe('ModuleAppMyAppsView', () => {
  it('renders installed apps and package review status without internal storage metadata', () => {
    const onPackageSubmitted = vi.fn();

    renderView(
      <ModuleAppMyAppsView
        hasMoreApps={true}
        loadingApps={false}
        loadingMoreApps={false}
        loadingSubmissions={false}
        searchQuery={''}
        apps={[
          {
            description: 'Local services module',
            displayName: 'Classified Info',
            id: 'app-1',
            installedVersion: { id: 'version-1', version: '1.0.0' },
            installationReadiness: {
              configuration: 'required',
              missingSecretCount: 1,
              runtime: 'ready',
            },
            publishedVersion: { id: 'version-2', version: '2.0.0' },
            updateAvailable: true,
          },
        ]}
        submissions={[
          {
            appDisplayName: 'Talent Recruitment',
            appId: null,
            appSlug: 'talent-recruitment',
            createdAt: '2026-07-10T00:00:00.000Z',
            fileName: 'talent-recruitment.zip',
            id: 'package-1',
            packageVersion: '0.1.0',
            publishedAt: null,
            rejectionReason: null,
            reviewedAt: null,
            reviewStatus: 'pending_review',
            sizeBytes: 2048,
            updatedAt: '2026-07-10T00:00:00.000Z',
          },
        ]}
        onLoadMoreApps={vi.fn()}
        onPackageSubmitted={onPackageSubmitted}
        onRetryApps={vi.fn()}
        onSearchApps={vi.fn()}
      />,
    );

    expect(screen.getByText('Classified Info')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.market.updateAvailable')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.readiness.configurationRequired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'moduleApps.market.openFor' })).toHaveAttribute(
      'href',
      '/apps/app-1/app',
    );
    expect(screen.getByRole('link', { name: 'moduleApps.market.viewDetailsFor' })).toHaveAttribute(
      'href',
      '/apps/app-1',
    );
    expect(screen.getByText('Talent Recruitment')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.submissions.status.pendingReview')).toBeInTheDocument();
    expect(screen.queryByText(/module-app-packages/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.packageUploader.submit' }));
    expect(onPackageSubmitted).toHaveBeenCalledTimes(1);
  });

  it('renders independent empty states for installed apps and submissions', () => {
    renderView(
      <ModuleAppMyAppsView
        apps={[]}
        hasMoreApps={false}
        loadingApps={false}
        loadingMoreApps={false}
        loadingSubmissions={false}
        searchQuery={''}
        submissions={[]}
        onLoadMoreApps={vi.fn()}
        onPackageSubmitted={vi.fn()}
        onRetryApps={vi.fn()}
        onSearchApps={vi.fn()}
      />,
    );

    expect(screen.getByText('moduleApps.installed.empty')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.submissions.empty')).toBeInTheDocument();
  });

  it('supports installed app search and loading another page', () => {
    const onLoadMoreApps = vi.fn();
    const onSearchApps = vi.fn();

    renderView(
      <ModuleAppMyAppsView
        apps={[{ displayName: 'Record Desk', id: 'app-1', slug: 'record-desk' }]}
        hasMoreApps={true}
        loadingApps={false}
        loadingMoreApps={false}
        loadingSubmissions={false}
        searchQuery={'desk'}
        submissions={[]}
        onLoadMoreApps={onLoadMoreApps}
        onPackageSubmitted={vi.fn()}
        onRetryApps={vi.fn()}
        onSearchApps={onSearchApps}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'moduleApps.installed.search' }), {
      target: { value: 'records' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.installed.loadMore' }));
    expect(onSearchApps).toHaveBeenCalledWith('records');
    expect(onLoadMoreApps).toHaveBeenCalledTimes(1);
  });
});
