import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const calls = vi.hoisted(() => ({ tokenRead: vi.fn(), request: vi.fn(), modal: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { market: { oidc: { getUserInfo: { mutate: calls.request } } } },
}));
vi.mock('@/services/_url', () => ({ MARKET_OIDC_ENDPOINTS: {} }));
vi.mock('@/store/serverConfig', () => ({ useServerConfigStore: () => true }));
vi.mock('@/store/serverConfig/selectors', () => ({ serverConfigSelectors: {} }));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/layout/AuthProvider/MarketAuth/tokenStorage', () => ({
  getMarketTokensFromDB: calls.tokenRead,
}));
vi.mock('@/layout/AuthProvider/MarketAuth/oidc', () => ({ MarketOIDC: calls.request }));
vi.mock('@/layout/AuthProvider/MarketAuth/useMarketUserProfile', () => ({
  useMarketUserProfile: calls.request,
}));
vi.mock('@/layout/AuthProvider/MarketAuth/ClaimResourcesModal', () => ({ default: calls.modal }));
vi.mock('@/layout/AuthProvider/MarketAuth/ProfileSetupModal', () => ({ default: calls.modal }));
vi.mock('@/layout/AuthProvider/MarketAuth/MarketAuthConfirmModal', () => ({
  default: calls.modal,
}));
vi.mock('antd', () => ({ App: { useApp: () => ({ message: {} }) } }));
import {
  MarketAuthProvider,
  useMarketAuth,
} from '@/layout/AuthProvider/MarketAuth/MarketAuthProvider';
import { marketAuthEvents } from '@/layout/AuthProvider/MarketAuth/events';

afterEach(cleanup);
const Consumer = () => {
  const auth = useMarketAuth();
  return (
    <button
      onClick={() => {
        void auth.signIn();
        void auth.handleUnauthorized();
      }}
    >
      Local session
    </button>
  );
};
it.each([false, true])(
  'refuses official auth including stale token/401 recovery (desktop=%s)',
  async (isDesktop) => {
    vi.clearAllMocks();
    calls.tokenRead.mockReturnValue({
      accessToken: 'fixture-revoked',
      expiresAt: Date.now() + 60000,
    });
    calls.request.mockRejectedValue(new Error('401'));
    render(
      <MarketAuthProvider localOnly isDesktop={isDesktop}>
        <Consumer />
      </MarketAuthProvider>,
    );
    marketAuthEvents.emit('market-unauthorized', {
      path: 'market.oidc.getUserInfo',
      scene: 'default',
      timestamp: Date.now(),
    });
    fireEvent.click(screen.getByText('Local session'));
    expect(calls.tokenRead).not.toHaveBeenCalled();
    expect(calls.request).not.toHaveBeenCalled();
    expect(calls.modal).not.toHaveBeenCalled();
    const spa = readFileSync('src/layout/SPAGlobalProvider/index.tsx', 'utf8');
    expect(spa).toContain('<MarketAuthProvider localOnly');
    expect(spa).toContain('<AuthProvider>');
  },
);
