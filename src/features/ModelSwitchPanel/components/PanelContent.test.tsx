/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelContent } from './PanelContent';

const testState = vi.hoisted(() => ({
  groupMode: 'byProvider' as 'byModel' | 'byProvider',
  handleGroupModeChange: vi.fn(),
  isDevMode: false,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
}));

vi.mock('react-rnd', () => ({
  Rnd: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/business/client/hooks/useBusinessModelPricing', () => ({
  useBusinessModelPricingPrefetch: vi.fn(),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => [],
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T,>(selector: (state: { config: { isDevMode: boolean } }) => T) =>
    selector({ config: { isDevMode: testState.isDevMode } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: (state: { config: { isDevMode: boolean } }) => state.config,
  },
}));

vi.mock('../hooks/usePanelSize', () => ({
  usePanelSize: () => ({
    handlePanelWidthChange: vi.fn(),
    panelHeight: 480,
    panelWidth: 320,
  }),
}));

vi.mock('../hooks/usePanelState', () => ({
  usePanelState: () => ({
    groupMode: testState.groupMode,
    handleGroupModeChange: testState.handleGroupModeChange,
  }),
}));

vi.mock('./Toolbar', () => ({
  Toolbar: ({ showGroupModeSwitch }: { showGroupModeSwitch: boolean }) => (
    <div data-show-group-mode-switch={String(showGroupModeSwitch)} data-testid="toolbar" />
  ),
}));

vi.mock('./List', () => ({
  List: ({ groupMode }: { groupMode: string }) => (
    <div data-group-mode={groupMode} data-testid="model-list" />
  ),
}));

describe('PanelContent', () => {
  beforeEach(() => {
    testState.groupMode = 'byProvider';
    testState.handleGroupModeChange.mockClear();
    testState.isDevMode = false;
  });

  it('passes the stored group mode to the list outside dev while hiding the group switch', () => {
    render(<PanelContent enabledList={[]} />);

    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-show-group-mode-switch', 'false');
    expect(screen.getByTestId('model-list')).toHaveAttribute('data-group-mode', 'byProvider');
  });
});
