import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileWorkspaceRecentItem } from '@/server/routers/lambda/recent';

import MobileRecentPage from './index';

const navigate = vi.fn();
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      const labels: Record<string, string> = {
        'mobile.recent.empty': 'No recent conversations',
        'mobile.recent.emptySearch': 'No matching conversations',
        'mobile.recent.createAgent': 'Create assistant',
        'mobile.recent.createAgentError': 'Unable to create assistant',
        'mobile.recent.clearSearch': 'Clear search',
        'mobile.recent.error': 'Failed to load recent conversations',
        'mobile.recent.group': 'Group',
        'mobile.recent.latest': 'Latest',
        'mobile.recent.loadMore': 'Load more',
        'mobile.recent.moreActions': `More actions for ${values?.name ?? ''}`,
        'mobile.recent.open': `Open ${values?.name ?? ''}`,
        'mobile.recent.pin': 'Pin',
        'mobile.recent.pinError': 'Unable to update pin',
        'mobile.recent.pinned': 'Pinned',
        'mobile.recent.refresh': 'Refresh recent conversations',
        'mobile.recent.retryPin': 'Retry pin',
        'mobile.recent.search': 'Search conversations',
        'mobile.recent.unpin': 'Unpin',
        'retry': 'Retry',
      };
      return labels[key] ?? key;
    },
  }),
}));
const storeState = vi.hoisted(() => ({
  home: {
    agentGroups: [] as any[],
    isAgentListInit: true,
    pinAgent: vi.fn(),
    pinAgentGroup: vi.fn(),
    pinnedAgents: [] as any[],
    refreshAgentList: vi.fn(),
    ungroupedAgents: [] as any[],
  },
  agent: {
    createAgent: vi.fn(),
  },
}));
const swrState = vi.hoisted(() => ({
  data: [] as Array<{ items: MobileWorkspaceRecentItem[]; nextCursor?: string }>,
  error: undefined as Error | undefined,
  isLoading: false,
  mutate: vi.fn(),
  setSize: vi.fn(),
  size: 1,
}));
const userState = vi.hoisted(() => ({ isLogin: true as boolean | undefined }));
const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }));

const swrOptions = vi.hoisted(() => [] as unknown[]);
const swrKeys = vi.hoisted(() => [] as unknown[]);
vi.mock('swr/infinite', () => ({
  default: (getKey: any, _fetcher: any, options: unknown) => {
    swrKeys.push(getKey(0, null));
    swrOptions.push(options);
    return swrState;
  },
}));
vi.mock('@/store/home', () => ({ useHomeStore: (selector: any) => selector(storeState.home) }));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: any) => selector(storeState.agent) }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector(userState) }));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: (state: typeof userState) => state.isLogin },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceState.activeWorkspaceId,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('./MobilePendingInbox', () => ({
  default: () => <div>Pending inbox content</div>,
}));
vi.mock('@/features/AgentGroupAvatar', () => ({
  default: () => <span data-testid="group-avatar" />,
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, disabled, loading, onClick }: any) => (
    <button
      aria-label={ariaLabel}
      data-loading={loading ? 'true' : 'false'}
      disabled={disabled}
      type="button"
      onClick={onClick}
    />
  ),
  Avatar: () => <span data-testid="agent-avatar" />,
  Button: ({ children, icon, onClick, ...props }: any) => (
    <button type="button" {...props} onClick={onClick}>
      {icon}
      {children}
    </button>
  ),
  Empty: ({ description }: any) => <div>{description}</div>,
  Flexbox: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Icon: () => null,
  SearchBar: ({ 'aria-label': ariaLabel, onChange, value }: any) => (
    <input aria-label={ariaLabel} value={value} onChange={onChange} />
  ),
  Skeleton: {
    Paragraph: () => <div data-testid="recent-skeleton" />,
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" {...props} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenu: ({ children, items }: any) => (
    <div>
      {children}
      {items.map((item: any) => (
        <button
          disabled={item.disabled}
          key={item.key}
          type="button"
          onClick={() => item.onClick?.({ domEvent: new Event('click') })}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Segmented: ({ onChange, options, value }: any) => (
    <div>
      {options.map((option: any) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  toast,
}));

const conversation = (
  id: string,
  kind: MobileWorkspaceRecentItem['kind'],
  title: string,
  pinned = false,
): MobileWorkspaceRecentItem => ({
  id,
  kind,
  pinned,
  routePath: kind === 'group' ? `/group/${id}` : `/agent/${id}`,
  sessionId: id,
  title,
  unreadCount: 0,
  updatedAt: new Date('2026-07-19T08:00:00.000Z'),
});

describe('MobileRecentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.home.isAgentListInit = true;
    storeState.home.pinnedAgents = [];
    storeState.home.agentGroups = [];
    storeState.home.ungroupedAgents = [];
    swrState.data = [
      {
        items: [
          conversation('agent-pinned', 'agent', 'Pinned Agent', true),
          conversation('group-pinned', 'group', 'Pinned Group', true),
          {
            ...conversation('agent-free', 'agent', 'Free Agent'),
            routePath: '/agent/agent-free/topic-new',
            topicTitle: 'New Topic',
            updatedAt: new Date('2026-07-19T10:00:00.000Z'),
          },
          {
            ...conversation('group-free', 'group', 'Free Group'),
            routePath: '/group/group-free?topic=topic-group',
            topicTitle: 'Group Topic',
          },
          conversation('agent-idle', 'agent', 'Idle Agent'),
        ],
        nextCursor: undefined,
      },
    ];
    swrState.error = undefined;
    swrState.isLoading = false;
    userState.isLogin = true;
    workspaceState.activeWorkspaceId = null;
    swrKeys.length = 0;
    swrOptions.length = 0;
    storeState.home.pinAgent.mockResolvedValue(undefined);
    storeState.home.pinAgentGroup.mockResolvedValue(undefined);
    storeState.agent.createAgent.mockResolvedValue({ agentId: 'agent-new' });
    storeState.home.refreshAgentList.mockResolvedValue(undefined);
  });

  it('renders the desktop assistant list with latest topics and navigates to a topic', () => {
    render(<MobileRecentPage />);

    expect(screen.getAllByTestId('recent-conversation-row').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Pinned Agent'),
      expect.stringContaining('Pinned Group'),
      expect.stringContaining('Free Agent'),
      expect.stringContaining('Free Group'),
      expect.stringContaining('Idle Agent'),
    ]);
    expect(screen.getByText('New Topic')).toBeInTheDocument();
    expect(screen.getByText('Group Topic')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Free Agent' }));
    expect(navigate).toHaveBeenCalledWith('/agent/agent-free/topic-new');
  });

  it('switches between recent conversations and the pending inbox', () => {
    render(<MobileRecentPage />);

    fireEvent.click(screen.getByRole('button', { name: 'mobile.recent.modePending' }));

    expect(screen.getByText('Pending inbox content')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search conversations' })).not.toBeInTheDocument();
  });

  it('uses a server-owned mobile query with focus and reconnect revalidation but no polling', () => {
    render(<MobileRecentPage />);

    expect(swrKeys.at(-1)).toEqual(['mobile-recent-workspace', null, '', undefined]);
    expect(swrOptions.at(-1)).toMatchObject({
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    });
    expect(swrOptions.at(-1)).not.toHaveProperty('revalidateAll');
    expect(swrOptions.at(-1)).not.toHaveProperty('refreshInterval');
  });

  it('keeps the load-more command at the mobile touch target size', () => {
    swrState.data[0] = { ...swrState.data[0]!, nextCursor: 'next-page' };
    render(<MobileRecentPage />);

    expect(screen.getByRole('button', { name: 'Load more' })).toHaveStyle({
      minHeight: '44px',
      minWidth: '44px',
    });
  });

  it('filters both pinned and recent sections using assistant and topic names', () => {
    render(<MobileRecentPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
      target: { value: 'group' },
    });

    expect(screen.queryByText('Pinned Agent')).not.toBeInTheDocument();
    expect(screen.getByText('Pinned Group')).toBeInTheDocument();
    expect(screen.getByText('Group Topic')).toBeInTheDocument();
  });

  it('renders loading, first-use empty, and error retry states', () => {
    swrState.isLoading = true;
    const { rerender } = render(<MobileRecentPage />);
    expect(screen.getByTestId('mobile-recent-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('mobile-recent-loading')).toHaveAttribute('role', 'status');

    swrState.isLoading = false;
    swrState.data = [{ items: [], nextCursor: undefined }];
    storeState.home.pinnedAgents = [];
    storeState.home.ungroupedAgents = [];
    rerender(<MobileRecentPage key="empty" />);
    expect(screen.getByText('No recent conversations')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create assistant' })).toBeInTheDocument();

    swrState.error = new Error('offline');
    rerender(<MobileRecentPage key="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load recent conversations');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('keeps a single Latest section heading and clears a filtered empty result', () => {
    render(<MobileRecentPage />);

    expect(screen.getAllByRole('heading', { name: 'Latest' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
      target: { value: 'missing' },
    });

    expect(screen.getByText('No matching conversations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Free Agent')).toBeInTheDocument();
  });

  it('creates an assistant from the first-use empty action using the header flow', async () => {
    swrState.data = [{ items: [], nextCursor: undefined }];
    render(<MobileRecentPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }));

    await waitFor(() => expect(storeState.agent.createAgent).toHaveBeenCalledWith({}));
    expect(storeState.home.refreshAgentList).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/agent/agent-new');
  });

  it('renders an empty state instead of an endless skeleton when logged out', () => {
    storeState.home.isAgentListInit = false;
    storeState.home.pinnedAgents = [];
    storeState.home.ungroupedAgents = [];
    swrState.data = [];
    userState.isLogin = false;

    render(<MobileRecentPage />);

    expect(screen.queryByTestId('mobile-recent-loading')).not.toBeInTheDocument();
    expect(screen.getByText('No recent conversations')).toBeInTheDocument();
    expect(swrKeys.at(-1)).toBeNull();
  });

  it('refreshes and reuses the existing agent and group pin actions', async () => {
    render(<MobileRecentPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh recent conversations' }));
    expect(swrState.mutate).toHaveBeenCalled();

    const topicRow = screen
      .getAllByTestId('recent-conversation-row')
      .find((row) => row.textContent?.includes('Free Agent'))!;
    fireEvent.click(within(topicRow).getByRole('button', { name: 'Pin' }));
    expect(storeState.home.pinAgent).toHaveBeenCalledWith('agent-free', true);
    await waitFor(() => expect(swrState.mutate).toHaveBeenCalledTimes(2));

    const groupRow = screen
      .getAllByTestId('recent-conversation-row')
      .find((row) => row.textContent?.includes('Pinned Group'))!;
    fireEvent.click(within(groupRow).getByRole('button', { name: 'Unpin' }));
    expect(storeState.home.pinAgentGroup).toHaveBeenCalledWith('group-pinned', false);
    await waitFor(() => expect(storeState.home.pinAgentGroup).toHaveBeenCalled());
  });

  it('reports pin failures with a retry action and re-enables the row action', async () => {
    storeState.home.pinAgent.mockRejectedValueOnce(new Error('offline'));
    render(<MobileRecentPage />);

    const agentRow = screen
      .getAllByTestId('recent-conversation-row')
      .find((row) => row.textContent?.includes('Free Agent'))!;
    fireEvent.click(within(agentRow).getByRole('button', { name: 'Pin' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const notification = toast.error.mock.calls[0][0];
    expect(notification.title).toBe('Unable to update pin');
    expect(notification.actions[0].label).toBe('Retry pin');
    await waitFor(() =>
      expect(within(agentRow).getByRole('button', { name: 'Pin' })).toBeEnabled(),
    );

    notification.actions[0].onClick();
    await waitFor(() => expect(storeState.home.pinAgent).toHaveBeenCalledTimes(2));
  });
});
