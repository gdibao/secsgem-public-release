import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileDiscoverPage from './index';

const navigate = vi.fn();
const rememberFocus = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      const labels: Record<string, string> = {
        'mobile.discover.browseCommunity': 'Browse Community',
        'mobile.discover.empty': 'No recommended assistants',
        'mobile.discover.emptyDescription':
          'Your admin has not curated any recommended assistants yet.',
        'mobile.discover.error': 'Unable to load recommended assistants',
        'mobile.discover.open': `Open ${values?.name ?? ''}`,
        'mobile.discover.retry': 'Retry',
        'mobile.refresh': 'Refresh',
      };
      return labels[key] ?? key;
    },
  }),
}));
const mobileState = vi.hoisted(() => ({
  config: {
    discover: {
      assistants: [],
      community: { enabled: true, title: 'Community' },
      featuredAssistants: [] as any[],
      title: 'Recommended assistants',
    },
    navigation: { items: [] },
  } as any,
  error: undefined as Error | undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));
const discoverState = vi.hoisted(() => ({
  assistantResponse: { items: [] as any[] },
  mcpResponse: { items: [] as any[] },
  mutateAssistants: vi.fn(),
  mutateMcps: vi.fn(),
  useAssistantList: vi.fn(() => ({
    data: discoverState.assistantResponse,
    error: undefined,
    isLoading: false,
    mutate: discoverState.mutateAssistants,
  })),
  useFetchMcpList: vi.fn(() => ({
    data: discoverState.mcpResponse,
    error: undefined,
    isLoading: false,
    mutate: discoverState.mutateMcps,
  })),
}));

vi.mock('../useMobileConfig', () => ({ useMobileConfig: () => mobileState }));
vi.mock('@/store/discover', () => ({
  useDiscoverStore: (selector: (state: typeof discoverState) => unknown) => selector(discoverState),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('../mobileSlotState', () => ({
  useMobileSlotState: () => ({ rememberFocus }),
}));
vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: Object.assign(
    ({ center, right }: any) => (
      <header>
        {center}
        {right}
      </header>
    ),
    {
      Title: ({ title }: any) => <h1>{title}</h1>,
    },
  ),
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, onClick }: any) => (
    <button aria-label={ariaLabel} type="button" onClick={onClick} />
  ),
  Avatar: ({ avatar, size, title }: any) => (
    <span data-avatar-size={size} data-testid="featured-assistant-avatar">
      {avatar || title}
    </span>
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
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

const assistant = (identifier: string, title: string) => ({
  description: `${title} description`,
  identifier,
  model: { displayName: 'GPT 4.1', id: 'gpt-4.1', provider: 'openai' },
  title,
});

describe('MobileDiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileState.config.discover.community.enabled = true;
    mobileState.config.discover.community.title = 'Community';
    mobileState.config.discover.featuredAssistants = [
      assistant('alpha', 'Alpha'),
      assistant('beta', 'Beta'),
      assistant('gamma', 'Gamma'),
    ];
    mobileState.error = undefined;
    mobileState.isLoading = false;
    mobileState.isValidating = false;
    discoverState.assistantResponse = { items: [] };
    discoverState.mcpResponse = { items: [] };
    vi.clearAllMocks();
  });

  it('renders configured assistants as compact rows with accessible open commands', () => {
    render(<MobileDiscoverPage />);

    const rows = screen.getAllByTestId('featured-assistant-row');
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText('GPT 4.1')).toHaveLength(3);
    for (const avatar of screen.getAllByTestId('featured-assistant-avatar')) {
      expect(avatar).toHaveAttribute('data-avatar-size', '44');
    }
    for (const description of screen.getAllByTestId('featured-assistant-description')) {
      expect(description).toHaveAttribute('data-clamp-lines', '2');
    }
    for (const model of screen.getAllByTestId('featured-assistant-model')) {
      expect(model).toHaveTextContent('GPT 4.1');
    }
    expect(
      screen.getAllByTestId('featured-assistant-title').map((title) => title.textContent),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);

    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha' }));
    expect(rememberFocus).toHaveBeenCalledWith('assistant:alpha');
    expect(navigate).toHaveBeenCalledWith('/community/agent/alpha', { escape: true });
  });

  it('renders row-shaped loading, curated empty, and retry states', () => {
    const { rerender } = render(<MobileDiscoverPage />);
    const responsiveListClass = screen.getByTestId('featured-assistant-list').className;

    mobileState.isLoading = true;
    rerender(<MobileDiscoverPage key="loading" />);
    expect(screen.getByRole('status', { name: 'Recommended assistants' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status', { name: 'Recommended assistants' })).toHaveClass(
      ...responsiveListClass.split(' '),
    );
    expect(screen.getByRole('status', { name: 'Recommended assistants' })).toHaveStyle({
      '--mobile-list-skeleton-avatar-size': '44px',
      '--mobile-list-skeleton-min-row-height': '76px',
      '--mobile-list-skeleton-trailing-width': '88px',
    });
    expect(screen.getAllByTestId('mobile-list-skeleton-row')).toHaveLength(4);

    mobileState.isLoading = false;
    mobileState.config.discover.featuredAssistants = [];
    rerender(<MobileDiscoverPage key="empty" />);
    expect(screen.getByText('No recommended assistants')).toBeInTheDocument();
    expect(
      screen.getByText('Your admin has not curated any recommended assistants yet.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse Community' }));
    expect(navigate).toHaveBeenCalledWith('/community', { escape: true });

    mobileState.error = new Error('offline');
    rerender(<MobileDiscoverPage key="error" />);
    expect(screen.getByText('Unable to load recommended assistants')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mobileState.mutate).toHaveBeenCalled();
  });

  it('manually refreshes recommendations', () => {
    render(<MobileDiscoverPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(mobileState.mutate).toHaveBeenCalled();
  });

  it('does not enable community recommendation requests when the section is hidden', () => {
    mobileState.config.discover.community.enabled = false;

    render(<MobileDiscoverPage />);

    expect(discoverState.useAssistantList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 4 }),
      { enabled: false },
    );
    expect(discoverState.useFetchMcpList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 4 }),
      { enabled: false },
    );
  });

  it('uses the configured discover tab label and renders community columns', () => {
    mobileState.config.navigation.items = [{ id: 'slot-3', label: 'Explore' }];
    discoverState.assistantResponse = {
      items: [
        {
          author: 'Creator',
          avatar: '/alpha.png',
          description: 'Community assistant',
          identifier: 'community-alpha',
          title: 'Community Alpha',
        },
      ],
    };
    discoverState.mcpResponse = {
      items: [
        {
          author: 'Tool maker',
          description: 'Community tool',
          icon: '/tool.png',
          identifier: 'community-tool',
          name: 'Community Tool',
        },
      ],
    };

    render(<MobileDiscoverPage />);

    expect(screen.getByRole('heading', { name: 'Explore' })).toBeInTheDocument();
    expect(screen.getByTestId('mobile-community-assistants')).toHaveTextContent('Community Alpha');
    expect(screen.getByTestId('mobile-community-tools')).toHaveTextContent('Community Tool');

    fireEvent.click(screen.getByRole('button', { name: 'Open Community Alpha' }));
    expect(navigate).toHaveBeenCalledWith('/community/agent/community-alpha', { escape: true });
  });
});
