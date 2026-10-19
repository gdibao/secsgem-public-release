import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecentRunResult from './RecentRunResult';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}:${values?.credits ?? values?.status ?? values?.value ?? values?.count ?? values?.name ?? ''}`,
  }),
}));

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: {
      items: [
        {
          id: 'run-1',
          billingSnapshot: {
            actualAiCredits: 8,
            chargedCredits: 15.8,
            externalApiCostCredits: 2,
            fixedServiceFeeCredits: 3,
            multiplier: 1.35,
          },
          outputSnapshot: {
            artifactIds: ['artifact-1'],
            model: 'model-a',
            provider: 'provider-a',
          },
          status: 'succeeded',
        },
      ],
    },
  })),
}));

describe('RecentRunResult', () => {
  it('renders the latest persisted billing and output snapshots', () => {
    render(
      <RecentRunResult
        installationId="00000000-0000-4000-8000-000000000001"
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByText('moduleApps.billing.actual:15.8')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.model:model-a')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.provider:provider-a')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.artifacts:1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close:' }));
    expect(screen.queryByTestId('module-app-recent-run')).not.toBeInTheDocument();
  });
});
