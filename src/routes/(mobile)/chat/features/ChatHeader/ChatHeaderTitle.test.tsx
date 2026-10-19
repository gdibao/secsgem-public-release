import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChatHeaderTitle from './ChatHeaderTitle';

const agentState = vi.hoisted(() => ({ isInbox: true, title: 'Inbox' }));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: { Title: ({ title }: { title: ReactNode }) => <header>{title}</header> },
}));
vi.mock('antd-style', () => ({ cssVar: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'New topic' }) }));
vi.mock('@/features/MobileWorkspace/useMobileConfig', () => ({
  useMobileConfig: () => ({ config: { brand: { displayName: 'Qingyou AI' } } }),
}));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: () => unknown) => selector() }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentTitle: () => agentState.title },
  builtinAgentSelectors: { isInboxAgent: () => agentState.isInbox },
}));
vi.mock('@/store/chat', () => ({ useChatStore: (selector: () => unknown) => selector() }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { currentActiveTopic: () => undefined, currentTopicCount: () => 0 },
}));
vi.mock('@/store/global', () => ({ useGlobalStore: (selector: (state: any) => unknown) => selector({ toggleMobileTopic: vi.fn() }) }));

describe('ChatHeaderTitle', () => {
  it('uses the configured mobile brand for the inbox conversation', () => {
    render(<ChatHeaderTitle />);

    expect(screen.getByText('Qingyou AI')).toBeInTheDocument();
  });
});
