import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RunResultPanel from './RunResultPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}:${values?.credits ?? values?.status ?? values?.value ?? values?.count ?? values?.name ?? ''}`,
  }),
}));

describe('RunResultPanel', () => {
  it('shows estimate before execution and actual settled credits after execution', () => {
    const estimate = {
      baseAiCredits: 10,
      externalApiCostCredits: 2,
      fixedServiceFeeCredits: 3,
      multiplier: 1.35,
      totalCredits: 18.5,
    };
    const { rerender } = render(<RunResultPanel estimate={estimate} />);

    expect(screen.getByText('moduleApps.billing.estimate:18.5')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.baseAi:10')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.fixedFee:3')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.externalApi:2')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.noRun:')).toBeInTheDocument();

    rerender(
      <RunResultPanel
        estimate={estimate}
        run={{
          artifactIds: [],
          billing: {
            actualAiCredits: 8,
            chargedCredits: 15.8,
            externalApiCostCredits: 2,
            fixedServiceFeeCredits: 3,
            multiplier: 1.35,
          },
          output: { model: 'model-a', provider: 'provider-a' },
          preview: 'done',
          status: 'succeeded',
        }}
      />,
    );
    expect(screen.getByText('moduleApps.billing.actual:15.8')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.baseAi:8')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.fixedFee:3')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.externalApi:2')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.multiplier:1.35')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.model:model-a')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.billing.provider:provider-a')).toBeInTheDocument();
  });
});
