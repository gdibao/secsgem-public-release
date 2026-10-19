import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import AdminOverviewPage from './AdminOverviewPage';

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown) => {
    const resource = Array.isArray(key) ? key[0] : key;

    if (resource === 'admin-overview-stats') {
      return {
        data: { activeSubscriptions: 12, dau: 18, revenueLast30dUsd: 256, totalUsers: 42 },
      };
    }
    if (resource === 'admin-overview-pending-changes') {
      return { data: { items: [], total: 3 } };
    }

    return {
      data: {
        brandName: 'ComHub',
        defaultAgentModel: 'gpt-5',
        defaultAgentProvider: 'openai',
        referralRewardCredits: 100,
      },
    };
  },
}));

describe('AdminOverviewPage', () => {
  it('renders a compact operational overview without duplicate quick-link panels', () => {
    render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: '后台工作台' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '关键指标' })).toHaveTextContent('总用户42');
    expect(screen.getByRole('region', { name: '关键指标' })).toHaveTextContent('有效订阅12');
    expect(screen.getByRole('heading', { level: 2, name: '待处理事项' })).toBeInTheDocument();
    expect(screen.getByText('套餐变更请求 3')).toBeInTheDocument();
    expect(screen.getByText('openai/gpt-5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '管理模块' })).toBeInTheDocument();
  });
});
