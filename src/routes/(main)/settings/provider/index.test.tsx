import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderDetailPage } from './index';

const mocks = vi.hoisted(() => ({
  isMobile: true,
  navigate: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-router', () => ({
  Outlet: () => null,
  useParams: () => ({ providerId: 'openai' }),
}));

vi.mock('@/const/version', () => ({ isCustomBranding: true }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    isMobile: (state: { isMobile: boolean }) => state.isMobile,
  },
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => boolean) =>
    selector({ isMobile: mocks.isMobile }),
}));

vi.mock('./_layout/Desktop/Container', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./(list)/Footer', () => ({ default: () => null }));

vi.mock('./ProviderMenu', () => ({ default: () => null }));

vi.mock('./detail', () => ({
  default: ({ onProviderSelect }: { onProviderSelect: (providerKey: string) => void }) => (
    <button type="button" onClick={() => onProviderSelect('anthropic')}>
      Select provider
    </button>
  ),
}));

afterEach(() => {
  mocks.isMobile = true;
  mocks.navigate.mockReset();
});

describe('ProviderDetailPage navigation', () => {
  it('keeps mobile provider navigation in personal settings', () => {
    render(<ProviderDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Select provider' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings/provider/anthropic', { escape: true });
  });

  it('preserves workspace-aware provider navigation on desktop', () => {
    mocks.isMobile = false;
    render(<ProviderDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Select provider' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings/provider/anthropic');
  });
});
