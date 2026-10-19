import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({ area: vi.fn(), header: vi.fn() }));

vi.mock('@/components/DragUploadZone', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));
vi.mock('@/store/agent', () => ({ useAgentStore: () => '' }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentModel: vi.fn(), currentAgentModelProvider: vi.fn() },
}));
vi.mock('./ConversationArea', () => ({
  default: (props: unknown) => {
    rendered.area(props);
    return null;
  },
}));
vi.mock('./Header', () => ({
  default: () => {
    rendered.header();
    return null;
  },
}));

import ChatConversation from './index';

describe('group ChatConversation', () => {
  it('uses the mobile conversation surface without the desktop header', () => {
    render(<ChatConversation mobile />);

    expect(rendered.header).not.toHaveBeenCalled();
    expect(rendered.area).toHaveBeenCalledWith({ mobile: true });
  });
});
