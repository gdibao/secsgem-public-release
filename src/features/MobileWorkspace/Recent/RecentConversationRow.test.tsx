import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecentConversationRow from './RecentConversationRow';
import type { MobileRecentConversation } from './recentItems';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; name?: string }) =>
      ({
        'mobile.recent.group': 'Group',
        'mobile.recent.justNow': 'Just now',
        'mobile.recent.moreActions': `More actions for ${values?.name ?? ''}`,
        'mobile.recent.open': `Open ${values?.name ?? ''}`,
        'mobile.recent.pin': 'Pin',
        'mobile.recent.unpin': 'Unpin',
        'mobile.recent.unread': `${values?.count ?? 0} unread messages`,
        'mobile.recent.today': 'Today',
        'mobile.recent.yesterday': 'Yesterday',
      })[key] ?? key,
  }),
}));
vi.mock('@/features/AgentGroupAvatar', () => ({
  default: ({ avatar, memberAvatars }: any) => (
    <div data-avatar={avatar} data-members={memberAvatars.length} data-testid="group-avatar" />
  ),
}));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ disabled, loading, onClick, title }: any) => (
    <button
      aria-label={title}
      data-loading={loading ? 'true' : 'false'}
      disabled={disabled}
      type="button"
      onClick={onClick}
    />
  ),
  Avatar: ({ avatar, background }: any) => (
    <div data-avatar={avatar} data-background={background} data-testid="agent-avatar" />
  ),
  Flexbox: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Icon: () => null,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  DropdownMenu: ({ children, items }: any) => (
    <div>
      {children}
      {items.map((item: any) => (
        <button disabled={item.disabled} key={item.key} type="button">
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

const item = (patch: Partial<MobileRecentConversation> = {}): MobileRecentConversation => ({
  avatar: 'assistant.png',
  backgroundColor: '#fff',
  id: 'agent-1',
  kind: 'agent',
  pinned: false,
  routePath: '/agent/agent-1',
  sessionId: 'agent-1',
  title: 'Assistant',
  unreadCount: 3,
  updatedAt: new Date('2026-07-19T10:00:00.000Z'),
  ...patch,
});

describe('RecentConversationRow', () => {
  it('renders the desktop agent avatar, unread count, date, and pending pin state', () => {
    render(
      <RecentConversationRow
        pending
        item={item({ topicTitle: 'Latest question' })}
        onOpen={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    expect(screen.getByTestId('agent-avatar')).toHaveAttribute('data-avatar', 'assistant.png');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByLabelText('3 unread messages')).toBeInTheDocument();
    expect(screen.getByText('Latest question')).toBeInTheDocument();
    expect(screen.getByTestId('recent-conversation-date')).toHaveAttribute(
      'dateTime',
      '2026-07-19T10:00:00.000Z',
    );
    expect(screen.getByRole('button', { name: 'More actions for Assistant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeDisabled();
  });

  it('renders composed member avatars for groups', () => {
    render(
      <RecentConversationRow
        item={item({
          avatar: [{ avatar: 'a.png' }, { avatar: 'b.png' }],
          kind: 'group',
          title: 'Team',
        })}
        onOpen={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    expect(screen.getByTestId('group-avatar')).toHaveAttribute('data-members', '2');
    expect(screen.getByText('Group')).toBeInTheDocument();
  });
});
