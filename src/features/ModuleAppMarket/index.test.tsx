import { ConfigProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as m from 'motion/react-m';
import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAppMarket from './index';

const swrState = vi.hoisted(() => ({
  data: [] as any[] | undefined,
  error: undefined as unknown,
  isLoading: false,
  mutate: vi.fn(),
}));
const swrMock = vi.hoisted(() => vi.fn(() => swrState));
const installedAppsState = vi.hoisted(() => ({
  error: undefined as unknown,
  hasMore: false,
  isLoading: false,
  isLoadingMore: false,
  items: [] as any[],
  loadMore: vi.fn(),
  retry: vi.fn(),
}));
const installedAppsMock = vi.hoisted(() => vi.fn(() => installedAppsState));

vi.mock('swr', () => ({ default: swrMock }));
vi.mock('./useInstalledApps', () => ({ useInstalledApps: installedAppsMock }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      if (key === 'moduleApps.market.openFor') return `Open ${values?.name ?? ''}`;
      if (key === 'moduleApps.market.viewDetailsFor') {
        return `View details for ${values?.name ?? ''}`;
      }

      return key;
    },
  }),
}));

vi.mock('./MyAppsOverview', () => ({
  default: () => <div>my-apps-overview</div>,
}));

const renderMarket = (ui: ReactElement) =>
  render(
    <ConfigProvider motion={m}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ConfigProvider>,
  );

describe('ModuleAppMarket', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    swrState.data = [];
    swrState.error = undefined;
    swrState.isLoading = false;
    installedAppsState.error = undefined;
    installedAppsState.hasMore = false;
    installedAppsState.isLoading = false;
    installedAppsState.isLoadingMore = false;
    installedAppsState.items = [];
  });

  it.each([
    ['all', 'moduleApps.market.title'],
    ['my', 'moduleApps.my.title'],
    ['team', 'moduleApps.team.title'],
  ] as const)('uses translated heading for %s mode', (mode, key) => {
    renderMarket(<ModuleAppMarket mode={mode} />);

    expect(screen.getByRole('heading', { name: key })).toBeInTheDocument();
  });

  it('loads team apps in an explicit workspace context', () => {
    installedAppsState.items = [
      {
        category: 'business',
        displayName: 'Team Desk',
        id: 'app-team',
        installed: true,
        installedVersion: { id: 'version-1', version: '1.0.0' },
        installationReadiness: {
          configuration: 'ready',
          missingSecretCount: 0,
          runtime: 'unavailable',
        },
        publishedVersion: { id: 'version-2', version: '2.0.0' },
        updateAvailable: true,
      },
    ];
    installedAppsState.hasMore = true;
    renderMarket(<ModuleAppMarket mode="team" workspaceId="workspace-1" />);

    expect(installedAppsMock).toHaveBeenCalledWith({
      enabled: true,
      query: '',
      scope: 'workspace',
      workspaceId: 'workspace-1',
    });
    expect(screen.getByRole('link', { name: 'View details for Team Desk' })).toHaveAttribute(
      'href',
      '/apps/app-team?workspaceId=workspace-1',
    );
    expect(screen.getByRole('button', { name: 'Open Team Desk' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open Team Desk' })).not.toBeInTheDocument();
    expect(screen.getByText('moduleApps.readiness.runtimeUnavailable')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.market.updateAvailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.installed.loadMore' }));
    expect(installedAppsState.loadMore).toHaveBeenCalledTimes(1);
  });

  it('debounces team app searches before changing the server query', () => {
    vi.useFakeTimers();
    renderMarket(<ModuleAppMarket mode="team" workspaceId="workspace-1" />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'moduleApps.installed.search' }), {
      target: { value: 'shared desk' },
    });
    expect(installedAppsMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: '' }));
    act(() => vi.advanceTimersByTime(250));
    expect(installedAppsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'shared desk' }),
    );
  });

  it('renders a semantic skeleton while the marketplace is loading', () => {
    swrState.data = undefined;
    swrState.isLoading = true;

    renderMarket(<ModuleAppMarket />);

    expect(screen.getByRole('status', { name: 'moduleApps.market.loading' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getAllByTestId('mobile-list-skeleton-row')).toHaveLength(4);
  });

  it('renders a retryable error state', () => {
    swrState.error = new Error('offline');

    renderMarket(<ModuleAppMarket />);

    expect(screen.getByTestId('mobile-state-view')).toHaveAttribute('data-variant', 'error');
    expect(screen.getByText('moduleApps.market.loadError')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.market.retry' }));
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('renders a purpose-built empty state when no apps are published', () => {
    renderMarket(<ModuleAppMarket />);

    expect(screen.getByTestId('mobile-state-view')).toHaveAttribute('data-variant', 'empty');
    expect(screen.getByText('moduleApps.market.empty')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.market.emptyDescription')).toBeInTheDocument();
  });

  it('renders published apps as semantic cards in the responsive grid', () => {
    swrState.data = [
      { category: 'business', displayName: 'Team Desk', id: 'app-team', installed: true },
      { category: 'creative', displayName: 'Studio', id: 'app-studio', installed: false },
    ];

    renderMarket(<ModuleAppMarket />);

    const grid = screen.getByTestId('module-app-market-grid');
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    });
    expect(within(grid).getAllByRole('article')).toHaveLength(2);
    expect(within(grid).getByRole('link', { name: 'View details for Team Desk' })).toHaveAttribute(
      'href',
      '/apps/app-team',
    );
  });
});
