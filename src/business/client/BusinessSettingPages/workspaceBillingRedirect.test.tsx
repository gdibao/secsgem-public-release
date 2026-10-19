/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceBillingBilling from './WorkspaceBillingBilling';
import WorkspaceBillingBudget from './WorkspaceBillingBudget';
import WorkspaceBillingCredits from './WorkspaceBillingCredits';
import WorkspaceBillingPlans from './WorkspaceBillingPlans';
import WorkspaceBillingUsage from './WorkspaceBillingUsage';

vi.mock('react-router', () => ({
  Navigate: ({ replace, to }: { replace?: boolean; to: string }) => (
    <div data-replace={replace ? 'true' : 'false'} data-testid="workspace-billing-redirect">
      {to}
    </div>
  ),
}));

describe('workspace billing settings routes', () => {
  it.each([
    ['plans', WorkspaceBillingPlans, '/settings/plans'],
    ['credits', WorkspaceBillingCredits, '/settings/credits'],
    ['billing', WorkspaceBillingBilling, '/settings/billing'],
    ['budget', WorkspaceBillingBudget, '/settings/billing'],
    ['usage', WorkspaceBillingUsage, '/settings/usage'],
  ])('redirects workspace %s to a usable personal settings page', (_tab, Page, target) => {
    render(<Page />);

    expect(screen.getByTestId('workspace-billing-redirect')).toHaveTextContent(target);
    expect(screen.getByTestId('workspace-billing-redirect')).toHaveAttribute(
      'data-replace',
      'true',
    );
  });
});
