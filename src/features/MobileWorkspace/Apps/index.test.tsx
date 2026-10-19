import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileAppsPage from './index';

const navigate = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      const labels: Record<string, string> = {
        'mobile.apps.browseMarket': 'Browse app market',
        'mobile.apps.builtIn': 'Built-in apps',
        'mobile.apps.empty': 'No available module apps',
        'mobile.apps.error': 'Unable to load module apps',
        'mobile.apps.loading': 'Loading apps',
        'mobile.apps.module': 'Module apps',
        'mobile.apps.open': `Open ${values?.name ?? ''}`,
        'mobile.apps.unavailable': `${values?.name ?? ''} unavailable`,
        'mobile.apps.retry': 'Retry module apps',
        'mobile.apps.title': 'Apps',
        'mobile.refresh': 'Refresh',
      };
      return labels[key] ?? key;
    },
  }),
}));
const moduleState = vi.hoisted(() => ({
  data: [] as any[] | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));
const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: 'workspace-1' as string | null }));
const swrCapture = vi.hoisted(() => ({
  fetcher: undefined as undefined | (() => Promise<unknown>),
  key: undefined as unknown,
}));
const listAvailableApps = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mobileState = vi.hoisted(() => ({
  config: {
    applications: {
      builtins: [
        {
          enabled: true,
          icon: 'list-todo',
          id: 'tasks',
          label: 'Work',
          order: 1,
          path: '/tasks',
        },
      ],
      featuredModuleAppIds: ['featured-app'],
    },
    navigation: {
      items: [{ id: 'slot-4', label: 'Tools' }],
    },
  } as any,
}));

vi.mock('swr', () => ({
  default: (key: unknown, fetcher: () => Promise<unknown>) => {
    swrCapture.key = key;
    swrCapture.fetcher = fetcher;
    return moduleState;
  },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceState.activeWorkspaceId,
}));
vi.mock('@/services/moduleApp', () => ({
  moduleAppService: { listAvailableApps },
}));
vi.mock('../useMobileConfig', () => ({ useMobileConfig: () => mobileState }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ left, right }: any) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));
vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="app-icon" />,
  Skeleton: {
    Avatar: () => <span data-testid="apps-loading-icon" />,
    Input: () => <span data-testid="apps-loading-label" />,
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType, type, ...props }: any) => (
    <button data-button-type={type} type={htmlType} {...props}>
      {children}
    </button>
  ),
}));
vi.mock('../MobilePageLayout', () => ({
  default: ({ children, header }: any) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));
vi.mock('../components', () => ({
  MobileIconGrid: ({ children, minCellSize, ...props }: any) => (
    <div data-mobile-grid-min-cell={minCellSize} data-testid="mobile-icon-grid" {...props}>
      {children}
    </div>
  ),
  MobileSection: ({ action, children, title, trailing, ...props }: any) => (
    <section {...props}>
      <h2>{title}</h2>
      {trailing}
      {action ? (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      {children}
    </section>
  ),
  MobileStateView: ({ action, title, variant }: any) => (
    <section data-testid="mobile-state-view" data-variant={variant}>
      <h2>{title}</h2>
      {action ? (
        <button
          data-button-type={action.primary === false ? 'default' : 'primary'}
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  ),
  MobileWorkspaceHeader: ({ actions, right, title }: any) => (
    <header>
      <h1>{title}</h1>
      {right}
      {actions?.map((action: any) => (
        <button
          aria-label={action.label}
          data-header-action="true"
          data-icon-only="true"
          key={action.label}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </header>
  ),
}));

const installedApp = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'General app',
  id: 'general-app',
  installed: true,
  installationReadiness: {
    configuration: 'ready',
    missingSecretCount: 0,
    runtime: 'ready',
  },
  installationScope: 'personal',
  planState: { runnable: true },
  status: 'published',
  ...overrides,
});

describe('MobileAppsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleState.data = [
      installedApp(),
      installedApp({
        displayName: 'Featured app',
        icon: 'https://cdn.example.com/featured.png',
        id: 'featured-app',
        installationScope: 'workspace',
        workspaceId: 'workspace-1',
      }),
      installedApp({ displayName: 'Draft app', id: 'draft-app', status: 'draft' }),
      installedApp({
        displayName: 'Blocked app',
        id: 'blocked-app',
        planState: { runnable: false },
      }),
    ];
    moduleState.error = undefined;
    moduleState.isLoading = false;
    moduleState.isValidating = false;
    workspaceState.activeWorkspaceId = 'workspace-1';
    swrCapture.fetcher = undefined;
    swrCapture.key = undefined;
  });

  it('opens configured built-ins, runnable module apps, and the app market', () => {
    render(<MobileAppsPage />);

    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeInTheDocument();
    expect(screen.getAllByTestId('mobile-module-app').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Featured app'),
      expect.stringContaining('General app'),
    ]);
    expect(screen.getByRole('img', { name: 'Featured app' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/featured.png',
    );
    expect(screen.queryByText('Draft app')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked app')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Work' }));
    expect(navigate).toHaveBeenCalledWith('/tasks');

    fireEvent.click(screen.getByRole('button', { name: 'Open Featured app' }));
    expect(navigate).toHaveBeenCalledWith(
      '/apps/featured-app/app?workspaceId=workspace-1&scopeType=workspace',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Browse app market' }));
    expect(navigate).toHaveBeenCalledWith('/apps/market');
  });

  it('uses the shared four-column launcher grid with a named market destination and icon refresh', () => {
    render(<MobileAppsPage />);

    expect(screen.getAllByTestId('mobile-icon-grid')).toHaveLength(2);
    for (const grid of screen.getAllByTestId('mobile-icon-grid')) {
      expect(grid).toHaveAttribute('data-mobile-grid-min-cell', '64');
    }

    expect(screen.getByRole('button', { name: 'Browse app market' })).toHaveAttribute(
      'data-button-type',
      'primary',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
      'data-header-action',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
      'data-icon-only',
      'true',
    );
  });

  it('scopes the single module-app request to the active workspace', async () => {
    render(<MobileAppsPage />);

    expect(swrCapture.key).toEqual(['mobile-module-apps', 'workspace-1']);
    await swrCapture.fetcher?.();
    expect(listAvailableApps).toHaveBeenCalledTimes(1);
    expect(listAvailableApps).toHaveBeenCalledWith('workspace-1');
  });

  it('keeps built-ins usable when module apps fail and retries only the module section', () => {
    moduleState.error = new Error('offline');
    render(<MobileAppsPage />);

    expect(screen.getByRole('button', { name: 'Open Work' })).toBeInTheDocument();
    expect(screen.getByText('Unable to load module apps')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry module apps' }));
    expect(moduleState.mutate).toHaveBeenCalled();
  });

  it('uses status semantics while module apps are loading', () => {
    moduleState.isLoading = true;
    render(<MobileAppsPage />);

    expect(screen.getByRole('button', { name: 'Browse app market' })).toHaveAttribute(
      'data-button-type',
      'primary',
    );
    expect(screen.getByTestId('mobile-apps-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('mobile-apps-loading')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('mobile-apps-loading')).toHaveAccessibleName('Loading apps');
    const loading = screen.getByTestId('mobile-apps-loading');
    expect(loading).toContainElement(within(loading).getByTestId('mobile-icon-grid'));
    expect(screen.getAllByTestId('apps-loading-icon')).toHaveLength(4);
    expect(screen.getAllByTestId('apps-loading-label')).toHaveLength(4);
  });

  it('keeps unresolved module apps in the loading geometry', () => {
    moduleState.data = undefined;
    moduleState.isLoading = false;
    render(<MobileAppsPage />);

    expect(screen.getAllByRole('button', { name: 'Browse app market' })).toHaveLength(1);
    expect(screen.getByTestId('mobile-apps-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('mobile-apps-loading')).toHaveAttribute('role', 'status');
    const loading = screen.getByTestId('mobile-apps-loading');
    expect(loading).toContainElement(within(loading).getByTestId('mobile-icon-grid'));
    expect(screen.getAllByTestId('apps-loading-icon')).toHaveLength(4);
    expect(screen.getAllByTestId('apps-loading-label')).toHaveLength(4);
    expect(screen.queryByTestId('mobile-state-view')).not.toBeInTheDocument();
  });

  it('opens personal module apps outside the workspace shell', () => {
    moduleState.data = [
      installedApp({
        displayName: 'Personal app',
        id: 'personal-app',
        installationScope: 'personal',
      }),
    ];
    render(<MobileAppsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Personal app' }));
    expect(navigate).toHaveBeenCalledWith('/apps/personal-app/app', { escape: true });
  });

  it('shows but does not open an installation whose runtime snapshot is unavailable', () => {
    moduleState.data = [
      installedApp({
        displayName: 'Unavailable app',
        id: 'unavailable-app',
        installationReadiness: {
          configuration: 'ready',
          missingSecretCount: 0,
          runtime: 'unavailable',
        },
      }),
    ];

    render(<MobileAppsPage />);

    const unavailableApp = screen.getByRole('button', { name: 'Unavailable app unavailable' });
    expect(unavailableApp).toBeDisabled();
    expect(unavailableApp).toHaveAttribute('data-readiness', 'unavailable');
    expect(screen.getByTitle('moduleApps.readiness.runtimeUnavailable')).toBeInTheDocument();
    fireEvent.click(unavailableApp);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a visible app icon when a module image fails to load', () => {
    render(<MobileAppsPage />);

    fireEvent.error(screen.getByRole('img', { name: 'Featured app' }));

    expect(
      within(screen.getByRole('button', { name: 'Open Featured app' })).getByTestId(
        'mobile-module-app-fallback-icon',
      ),
    ).toBeInTheDocument();
  });

  it('shows exactly one compact market CTA when no module apps are installed', () => {
    moduleState.data = [];
    render(<MobileAppsPage />);

    expect(screen.getAllByRole('button', { name: 'Browse app market' })).toHaveLength(1);
    expect(screen.getByTestId('mobile-state-view')).toHaveAttribute('data-variant', 'empty');
    expect(screen.getByRole('button', { name: 'Browse app market' })).toHaveAttribute(
      'data-button-type',
      'primary',
    );
  });

  it('manually refreshes module apps', () => {
    render(<MobileAppsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(moduleState.mutate).toHaveBeenCalled();
  });
});
