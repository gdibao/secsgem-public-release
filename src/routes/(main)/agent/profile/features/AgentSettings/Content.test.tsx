import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import Content from './Content';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'inbox-agent',
    config: {},
    isCurrentAgentHeterogeneous: false,
    isInbox: true,
    meta: {},
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
  },
  serverState: {
    featureFlags: {
      enableAgentSelfIteration: true,
    },
  },
  userState: {
    defaultAgentMeta: {
      avatar: '/images/configured-agent.svg',
      title: 'Configured Agent',
    } as { avatar?: string; title?: string },
    enableAgentGraphConfig: false,
  },
}));

vi.mock('@/features/AgentSetting', () => ({
  AgentSettings: ({ tab }: { tab: ChatSettingsTabs }) => (
    <div data-tab={tab} data-testid="agent-settings-content" />
  ),
  SettingsModalLayout: ({
    activeTab,
    avatar,
    tabs = [],
    children,
    title,
  }: {
    activeTab?: string;
    avatar?: string;
    children?: ReactNode;
    tabs?: { key: string }[];
    title?: string;
  }) => (
    <div
      data-active={activeTab}
      data-avatar={avatar}
      data-tabs={tabs.map((tab) => tab.key).join(',')}
      data-testid="layout"
      data-title={title}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/features/Brand/BrandProvider', () => ({
  useBrand: () => ({ logoUrl: '/brand.svg', name: 'ComHub Brand' }),
}));
vi.mock('@/store/agent', () => {
  const useAgentStore = (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState);
  useAgentStore.getState = () => mocks.agentState;

  return { useAgentStore };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (state: typeof mocks.agentState) => state.config,
    currentAgentMeta: (state: typeof mocks.agentState) => state.meta,
    isCurrentAgentHeterogeneous: (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
  builtinAgentSelectors: {
    isInboxAgent: (state: typeof mocks.agentState) => state.isInbox,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof mocks.serverState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof mocks.serverState) => unknown) =>
    selector(mocks.serverState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentGraphConfig: (state: typeof mocks.userState) => state.enableAgentGraphConfig,
  },
  settingsSelectors: {
    defaultAgentMeta: (state: typeof mocks.userState) => state.defaultAgentMeta,
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
describe('AgentSettings Content', () => {
  beforeEach(() => {
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.agentState.isInbox = true;
    mocks.serverState.featureFlags.enableAgentSelfIteration = true;
    mocks.userState.enableAgentGraphConfig = false;
    mocks.userState.defaultAgentMeta = {
      avatar: '/images/configured-agent.svg',
      title: 'Configured Agent',
    };
  });

  it('exposes both tabs for inbox when feature is on', () => {
    render(<Content />);

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-active', ChatSettingsTabs.Opening);
    expect(layout).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.SelfIteration}`,
    );
    expect(screen.getByTestId('agent-settings-content')).toHaveAttribute(
      'data-tab',
      ChatSettingsTabs.Opening,
    );
  });

  it('exposes both tabs when not inbox and feature is on', () => {
    mocks.agentState.isInbox = false;

    render(<Content />);

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-active', ChatSettingsTabs.Opening);
    expect(layout).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.SelfIteration}`,
    );
  });

  it('falls back to opening when feature flag is off (inbox)', () => {
    mocks.serverState.featureFlags.enableAgentSelfIteration = false;

    render(<Content />);

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-active', ChatSettingsTabs.Opening);
    expect(layout).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
  });

  it('exposes only opening when feature flag is off', () => {
    mocks.agentState.isInbox = false;
    mocks.serverState.featureFlags.enableAgentSelfIteration = false;

    render(<Content />);

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
  });

  it('shows graph only for eligible agents when the lab preference is enabled', () => {
    mocks.agentState.isInbox = false;
    mocks.userState.enableAgentGraphConfig = true;

    const { rerender } = render(<Content />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.SelfIteration},${ChatSettingsTabs.Graph}`,
    );

    mocks.agentState.isCurrentAgentHeterogeneous = true;
    rerender(<Content key="heterogeneous-agent" />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.SelfIteration}`,
    );
  });

  it('uses configured inbox identity and falls back to the ComHub brand', () => {
    const { rerender } = render(<Content />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-title', 'Configured Agent');
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-avatar',
      '/images/configured-agent.svg',
    );

    mocks.userState.defaultAgentMeta = {};
    rerender(<Content key="brand-fallback" />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-title', 'ComHub Brand');
    expect(screen.getByTestId('layout')).toHaveAttribute('data-avatar', '/brand.svg');
  });
});
