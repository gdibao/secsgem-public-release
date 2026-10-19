import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABBAR_HEIGHT, MOBILE_WORKSPACE_CONTENT_MAX_WIDTH } from '@/const/layoutTokens';
import { DEFAULT_MOBILE_CONFIG, normalizeMobileConfig } from '@/const/mobileConfig';

import MobileWorkspaceShell, { MOBILE_WORKSPACE_CLEARANCE_VAR } from './MobileWorkspaceShell';
import { useMobileConfig } from './useMobileConfig';

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('./MobileTabBar', () => ({ default: () => <nav aria-label="tabs" /> }));
vi.mock('./useMobileConfig', () => ({ useMobileConfig: vi.fn() }));
const onlineState = vi.hoisted(() => ({ value: true }));
vi.mock('./useOnlineStatus', () => ({ useOnlineStatus: () => onlineState.value }));

describe('MobileWorkspaceShell', () => {
  beforeEach(() => {
    onlineState.value = true;
    vi.mocked(useMobileConfig).mockReturnValue({
      config: normalizeMobileConfig({
        ...DEFAULT_MOBILE_CONFIG,
        navigation: {
          items: DEFAULT_MOBILE_CONFIG.navigation.items.map((item) =>
            item.id === 'slot-2' ? { ...item, path: '/tasks' } : item,
          ),
        },
      }),
      error: undefined,
      isLoading: false,
      isUsingCachedConfig: false,
      isValidating: false,
      mutate: vi.fn(),
      revision: 0,
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('owns bottom clearance for configured legacy destinations', () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <MobileWorkspaceShell>
          <div>Tasks</div>
        </MobileWorkspaceShell>
      </MemoryRouter>,
    );

    const shell = screen.getByTestId('mobile-workspace-shell');
    expect(shell).toHaveAttribute('data-tab-bar-visible', 'true');
    expect(shell.style.getPropertyValue(MOBILE_WORKSPACE_CLEARANCE_VAR)).toContain(
      'env(safe-area-inset-bottom)',
    );
  });

  it('removes bottom clearance on deep destinations', () => {
    render(
      <MemoryRouter initialEntries={['/tasks/detail']}>
        <MobileWorkspaceShell>
          <div>Task detail</div>
        </MobileWorkspaceShell>
      </MemoryRouter>,
    );

    const shell = screen.getByTestId('mobile-workspace-shell');
    expect(shell).toHaveAttribute('data-tab-bar-visible', 'false');
    expect(shell.style.getPropertyValue(MOBILE_WORKSPACE_CLEARANCE_VAR)).toBe('0px');
  });

  it('keeps offline feedback within the content width above the tab bar', () => {
    onlineState.value = false;

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <MobileWorkspaceShell>
          <div>Tasks</div>
        </MobileWorkspaceShell>
      </MemoryRouter>,
    );

    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute(
      'data-mobile-content-max-width',
      String(MOBILE_WORKSPACE_CONTENT_MAX_WIDTH),
    );
    expect(notice).toHaveStyle({
      bottom: `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom) + 8px)`,
      maxWidth: `${MOBILE_WORKSPACE_CONTENT_MAX_WIDTH}px`,
      width: 'calc(100% - 24px)',
    });
  });
});
