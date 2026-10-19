import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SessionHeader from '@/features/MobileHome/Layout/SessionHeader';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  navigate: vi.fn(),
  refreshAgentList: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));

const mobileConfig = vi.hoisted(() => ({
  config: {
    brand: {
      displayName: 'Mobile ComHub',
      logoUrl: '/mobile-logo.png',
    } as { displayName: null | string; logoUrl: null | string },
  },
}));

vi.mock('@/features/MobileWorkspace/useMobileConfig', () => ({
  useMobileConfig: () => mobileConfig,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: any) => selector(mocks) }));
vi.mock('@/store/home', () => ({ useHomeStore: (selector: any) => selector(mocks) }));
vi.mock('@/components/Branding', () => ({ ProductLogo: () => <span>Global Brand</span> }));
vi.mock('@/features/User/UserAvatar', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button aria-label="Profile" type="button" onClick={onClick} />
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'mobile.recent.createAgent': 'Create assistant',
        'mobile.recent.createAgentError': 'Unable to create assistant',
      })[key] ?? key,
  }),
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ disabled, onClick, title }: any) => (
    <button aria-label={title} disabled={disabled} type="button" onClick={onClick} />
  ),
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Icon: () => <span>loading</span>,
}));
vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ left, right }: any) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({ toast }));

describe('SessionHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileConfig.config.brand = { displayName: 'Mobile ComHub', logoUrl: '/mobile-logo.png' };
    mocks.createAgent.mockResolvedValue({ agentId: 'agent-new' });
    mocks.refreshAgentList.mockResolvedValue(undefined);
  });

  it('renders the configured mobile brand and creates an agent before navigating', async () => {
    render(<SessionHeader />);

    expect(screen.getByText('Mobile ComHub')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mobile ComHub' })).toHaveAttribute(
      'src',
      '/mobile-logo.png',
    );
    expect(screen.queryByText('Global Brand')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }));

    await waitFor(() => expect(mocks.createAgent).toHaveBeenCalledWith({}));
    expect(mocks.refreshAgentList).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new');
  });

  it('falls back to the global brand and reports creation failures', async () => {
    mobileConfig.config.brand = { displayName: null, logoUrl: null };
    mocks.createAgent.mockRejectedValueOnce(new Error('offline'));
    render(<SessionHeader />);

    expect(screen.getByText('Global Brand')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to create assistant'));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create assistant' })).toBeEnabled();
  });

  it('navigates to a created agent even when refreshing the sidebar fails', async () => {
    mocks.refreshAgentList.mockRejectedValueOnce(new Error('refresh failed'));
    render(<SessionHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
