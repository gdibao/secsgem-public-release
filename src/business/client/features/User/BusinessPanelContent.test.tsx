import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import BusinessPanelContent from './BusinessPanelContent';

vi.mock('@/business/client/BusinessSettingPages/shared', () => ({
  formatCredits: (value: number) => `${value.toLocaleString('en-US')} M`,
  useBusinessSubscriptionProfile: () => ({
    accountSummary: { breakdown: { subscription: { available: 1624.45 } } },
    currentPlan: 'premium',
    subscriptionSummary: { monthlyCredits: 720 },
  }),
}));

vi.mock('@/features/PlanIcon', () => ({
  default: () => <span>专业版</span>,
}));

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

describe('BusinessPanelContent', () => {
  it('separates the available subscription credits from the cycle allowance', () => {
    render(<BusinessPanelContent />);

    expect(screen.getByText('专业版')).toBeInTheDocument();
    expect(screen.getByText('订阅积分')).toBeInTheDocument();
    expect(screen.getByText('1,624.45 M')).toBeInTheDocument();
    expect(screen.getByText('本周期额度 720 M')).toBeInTheDocument();
    expect(screen.queryByText('/')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '升级' })).toHaveAttribute('href', '/settings/plans');
  });
});
