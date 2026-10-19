import type { ModuleAppLaunchContext } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModuleAppRuntimeView } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PageRenderer', () => ({
  default: ({ context }: { context: ModuleAppLaunchContext }) => (
    <div data-testid="runtime-frame">{context.displayName}</div>
  ),
}));

vi.mock('./RecentRunResult', () => ({
  default: () => <div data-testid="recent-run-result" />,
}));

const context: ModuleAppLaunchContext = {
  capability: 'signed-capability',
  displayName: 'Jobs Board',
  expiresAt: '2026-07-11T08:05:00.000Z',
  iframeUrl: 'https://module-runtime.example.com/artifacts/hash/dist/index.html',
  installationId: '00000000-0000-4000-8000-000000000001',
  nonce: 'launch-nonce-0001',
  runtimeOrigin: 'https://module-runtime.example.com',
};

describe('ModuleAppRuntimeView', () => {
  it('renders the trusted executable application context', () => {
    render(<ModuleAppRuntimeView context={context} loading={false} onRetry={vi.fn()} />);

    expect(screen.getByTestId('runtime-frame')).toHaveTextContent('Jobs Board');
    expect(screen.getByTestId('recent-run-result')).toBeInTheDocument();
  });

  it.each([
    ['module_app_runtime_unavailable', 'moduleApps.runtime.unavailable.title'],
    ['module_app_build_not_ready', 'moduleApps.runtime.buildNotReady.title'],
    ['module_app_installation_required', 'moduleApps.runtime.denied.title'],
    ['unexpected_failure', 'moduleApps.runtime.failure.title'],
  ])('renders a retryable state for %s', (message, titleKey) => {
    const onRetry = vi.fn();
    render(<ModuleAppRuntimeView error={new Error(message)} loading={false} onRetry={onRetry} />);

    expect(screen.getByText(titleKey)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit loading state', () => {
    render(<ModuleAppRuntimeView loading onRetry={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
