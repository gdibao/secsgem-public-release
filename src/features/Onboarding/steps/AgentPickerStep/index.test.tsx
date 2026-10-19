import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentPickerStep from './index';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));
vi.mock('@/features/LocalAssistantMarket', () => ({
  default: ({ initialDomain, onInstalled }: any) => (
    <div data-domain-id={initialDomain} data-testid="local-onboarding-directory">
      <button type="button" onClick={() => onInstalled('native-private-agent')}>
        Install local assistant
      </button>
    </div>
  ),
}));
vi.mock('@/features/LocalAssistantMarket/catalog', () => ({
  localDomains: Array.from({ length: 18 }, (_, index) => ({
    id: `domain-${index + 1}`,
    name: `Domain ${index + 1}`,
  })),
}));
vi.mock('../../components/LobeMessage', () => ({ default: () => null }));

const navigate = vi.fn();
const finishOnboarding = vi.fn().mockResolvedValue(undefined);
const metrics = vi.hoisted(() => ({
  trackOnboardingCompleted: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
}));
let searchParams = new URLSearchParams();

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams],
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/onboardingMetrics', () => metrics);
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { finishOnboarding: typeof finishOnboarding }) => unknown) =>
    selector({ finishOnboarding }),
}));

beforeEach(() => {
  navigate.mockClear();
  finishOnboarding.mockClear();
  metrics.trackOnboardingCompleted.mockClear();
  metrics.trackOnboardingStepCompleted.mockClear();
  searchParams = new URLSearchParams();
});
afterEach(cleanup);

describe('AgentPickerStep local directory', () => {
  it('shows all 18 local domains before rendering a catalog', () => {
    render(<AgentPickerStep onBack={vi.fn()} />);
    expect(screen.getAllByTestId('onboarding-local-domain')).toHaveLength(18);
    expect(screen.queryByTestId('local-onboarding-directory')).toBeNull();
  });

  it('opens only the selected local domain and completes after explicit installation', async () => {
    render(<AgentPickerStep onBack={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId('onboarding-local-domain')[2]);
    expect(screen.getByTestId('local-onboarding-directory').getAttribute('data-domain-id')).toBe(
      'domain-3',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install local assistant' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(finishOnboarding).toHaveBeenCalledTimes(1);
  });

  it('lets a user continue to the native home without any installation', async () => {
    render(<AgentPickerStep onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('onboarding-local-later'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(finishOnboarding).toHaveBeenCalledTimes(1);
  });
});
