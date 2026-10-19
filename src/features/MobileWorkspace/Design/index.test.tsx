import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobilePublicConfigV1 } from '@/const/mobileConfig';
import type { MobileRecentDesignItem } from '@/server/routers/lambda/mobileDesign';

import MobileDesignPage from './index';

const navigate = vi.fn();
const createNewPage = vi.fn();
const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: 'workspace-1' as string | null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      const labels: Record<string, string> = {
        'mobile.design.create': 'Create',
        'mobile.design.createDocument': 'Create document',
        'mobile.design.createError': 'Unable to create document',
        'mobile.design.createTool': `Create ${values?.name ?? ''}`,
        'mobile.design.empty': 'No recent design work',
        'mobile.design.error': 'Unable to load recent design work',
        'mobile.design.kind.document': 'Document',
        'mobile.design.kind.image': 'Image',
        'mobile.design.kind.ppt': 'PPT',
        'mobile.design.open': `Open ${values?.name ?? ''}`,
        'mobile.design.startNewPresentation': 'Starts a new presentation',
        'mobile.design.recent': 'Recent work',
        'mobile.design.retry': 'Retry',
        'mobile.design.retryCreate': `Retry creating ${values?.name ?? ''}`,
        'mobile.design.untitled': 'Untitled',
        'mobile.refresh': 'Refresh',
      };
      return labels[key] ?? key;
    },
  }),
}));
const swrState = vi.hoisted(() => ({
  data: [] as MobileRecentDesignItem[],
  error: undefined as Error | undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));
const mobileConfig = vi.hoisted(
  () =>
    ({
      applications: { builtins: [], featuredModuleAppIds: [] },
      brand: { displayName: 'ComHub', logoUrl: null },
      design: {
        tools: [
          { enabled: true, icon: 'image', id: 'image', label: 'Images', order: 2 },
          { enabled: true, icon: 'file-text', id: 'document', label: 'Write', order: 1 },
          { enabled: true, icon: 'presentation', id: 'ppt', label: 'Slides', order: 3 },
        ],
      },
      discover: {
        assistants: [],
        community: { enabled: true, title: 'Community' },
        title: 'Discover',
      },
      navigation: {
        items: [
          {
            icon: 'palette',
            id: 'slot-2',
            label: 'Design Lab',
            order: 2,
            path: '/design',
            visible: true,
          },
        ],
      },
      version: 1,
    }) as MobilePublicConfigV1,
);

vi.mock('swr', () => ({ default: () => swrState }));
vi.mock('../useMobileConfig', () => ({ useMobileConfig: () => ({ config: mobileConfig }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceState.activeWorkspaceId,
}));
vi.mock('@/store/page', () => ({ usePageStore: (selector: any) => selector({ createNewPage }) }));
vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({ center, left, right }: any) => (
    <header>
      {left}
      {center}
      {right}
    </header>
  );
  ChatHeader.Title = ({ title }: any) => <h1>{title}</h1>;

  return { ChatHeader };
});
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" {...props} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon: Icon, onClick, ...props }: any) => (
    <button type="button" {...props} onClick={onClick}>
      <Icon />
    </button>
  ),
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" {...props} onClick={onClick}>
      {children}
    </button>
  ),
  Icon: () => <span data-testid="design-icon" />,
}));
vi.mock('../MobilePageLayout', () => ({
  default: ({ children, header }: any) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

const recentItem = (overrides: Partial<MobileRecentDesignItem> = {}): MobileRecentDesignItem => ({
  id: 'doc-1',
  kind: 'document',
  routePath: '/page/doc-1',
  title: 'Quarterly report',
  updatedAt: new Date('2026-07-19T08:00:00.000Z'),
  ...overrides,
});

describe('MobileDesignPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNewPage.mockResolvedValue('new-doc');
    swrState.data = [recentItem()];
    swrState.error = undefined;
    swrState.isLoading = false;
    swrState.isValidating = false;
  });

  it('renders exactly one header refresh action and manually refreshes recent design work', () => {
    render(<MobileDesignPage />);

    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('renders configured quick-create tools before recent work and opens existing routes', async () => {
    render(<MobileDesignPage />);

    expect(screen.getByText('Design Lab')).toBeInTheDocument();
    expect(screen.getAllByTestId('mobile-design-tool').map((tool) => tool.textContent)).toEqual([
      expect.stringContaining('Write'),
      expect.stringContaining('Images'),
      expect.stringContaining('Slides'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Create Write' }));
    await waitFor(() =>
      expect(createNewPage).toHaveBeenCalledWith('Untitled', { suppressFailureNavigation: true }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/page/new-doc'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create Images' })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Images' }));
    expect(navigate).toHaveBeenCalledWith('/image');

    fireEvent.click(screen.getByRole('button', { name: 'Open Quarterly report' }));
    expect(navigate).toHaveBeenCalledWith('/page/doc-1');
  });

  it('renders narrow-safe recent row areas separately', () => {
    swrState.data = [recentItem({ status: 'Draft' })];

    render(<MobileDesignPage />);

    const row = screen.getByTestId('mobile-design-recent-row');
    expect(screen.getByTestId('mobile-design-recent-title')).toHaveTextContent('Quarterly report');
    expect(screen.getByTestId('mobile-design-recent-kind')).toHaveTextContent('Document');
    expect(screen.getByTestId('mobile-design-recent-status')).toHaveTextContent('Draft');
    expect(screen.getByTestId('mobile-design-recent-date').tagName).toBe('TIME');
    expect(row).toContainElement(screen.getByTestId('mobile-design-recent-title'));
    expect(row).toContainElement(screen.getByTestId('mobile-design-recent-date'));
  });

  it('keeps create tools available across recent loading, empty, and retry states', () => {
    swrState.isLoading = true;
    const { rerender } = render(<MobileDesignPage />);
    expect(screen.getByRole('button', { name: 'Create Write' })).toBeInTheDocument();
    const loadingStatus = screen.getByRole('status', { name: 'Recent work' });
    expect(loadingStatus).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('mobile-list-skeleton-row')).toHaveLength(4);

    swrState.isLoading = false;
    swrState.data = [];
    rerender(<MobileDesignPage key="empty" />);
    expect(screen.getByText('No recent design work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create document' })).toBeEnabled();

    swrState.error = new Error('offline');
    rerender(<MobileDesignPage key="error" />);
    expect(screen.getByText('Unable to load recent design work')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('preserves recent page data and retries the failed document tool', async () => {
    createNewPage.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('retried-doc');
    render(<MobileDesignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Write' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to create document'),
    );
    expect(screen.getByRole('button', { name: 'Open Quarterly report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Write' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry creating Write' }));
    await waitFor(() => expect(createNewPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/page/retried-doc'));
  });

  it('labels PPT records that cannot be resumed as a new presentation action', () => {
    swrState.data = [
      recentItem({
        id: 'ppt-new-only',
        kind: 'ppt',
        resumeSupported: false,
        routePath: '/ppt',
        title: 'Legacy deck',
      }),
    ];

    render(<MobileDesignPage />);

    expect(screen.getByRole('button', { name: 'Starts a new presentation' })).toHaveTextContent(
      'Starts a new presentation',
    );
  });
});
