// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';

import Platform from './Platform';

vi.mock('@lobehub/icons', () => {
  const MockIcon = () => <span data-testid="icon" />;

  return {
    Claude: { Color: MockIcon },
    Cline: MockIcon,
    Cursor: MockIcon,
    OpenAI: MockIcon,
  };
});

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <span data-testid="avatar" />,
  Block: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: React.ReactNode }) => <pre>{children}</pre>,
  Icon: () => <span data-testid="lucide-icon" />,
  Markdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Segmented: () => <div />,
  Select: () => <select />,
  Text: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
}));

vi.mock('antd', () => ({
  Divider: () => <hr />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => ({ name: 'QingyouAI' }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: () => 'inbox-id',
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: () => vi.fn(),
}));

vi.mock('../../../../components/Title', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('./VsCodeIcon', () => ({
  default: () => <span data-testid="vscode-icon" />,
}));

describe('Skill sidebar Platform', () => {
  it('uses admin configured Skill CTA text from runtime customization', () => {
    render(
      <ServerConfigStoreProvider
        serverConfig={{
          aiProvider: {},
          customization: { skillUseButtonLabel: 'Use in ComHub' },
          telemetry: {},
        }}
      >
        <Platform identifier="demo-skill" />
      </ServerConfigStoreProvider>,
    );

    expect(screen.getByRole('button', { name: /Use in ComHub/ })).toBeInTheDocument();
  });
});
