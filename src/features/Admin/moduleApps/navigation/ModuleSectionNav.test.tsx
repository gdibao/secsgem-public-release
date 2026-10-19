import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import ModuleSectionNav from './ModuleSectionNav';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }),
}));

describe('ModuleSectionNav', () => {
  it('renders only finance policy sections for finance admins', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin/modules/finance/revenue']}>
        <ModuleSectionNav role="finance_admin" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publishers' })).toBeInTheDocument();
    const finance = screen.getByRole('group', { name: 'finance' });
    expect(
      within(finance)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['revenue', 'payments', 'payouts']);
    expect(screen.queryByRole('link', { name: 'apps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'operations' })).not.toBeInTheDocument();
  });

  it('keeps finance and operations as separate groups for full admins', () => {
    render(
      <MemoryRouter>
        <ModuleSectionNav role="admin" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('group', { name: 'finance' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'operations' })).toBeInTheDocument();
  });

  it('uses localized labels for every center and detail section', () => {
    const zh = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'locales/zh-CN/common.json'), 'utf8'),
    );
    const centerKeys = [
      'overview',
      'apps',
      'reviews',
      'publishers',
      'finance',
      'revenue',
      'payments',
      'payouts',
      'operations',
      'installs',
      'records',
      'runs',
      'artifacts',
      'audit',
    ];
    const detailKeys = ['overview', 'configuration', 'entitlements', 'products', 'runtime'];

    expect(
      Object.fromEntries(
        centerKeys.map((key) => [key, zh[`moduleApps.admin.center.navigation.${key}`]]),
      ),
    ).toEqual({
      apps: '应用',
      artifacts: '产物',
      audit: '审计',
      finance: '财务',
      installs: '安装',
      operations: '运维',
      overview: '概览',
      payments: '支付',
      payouts: '提现',
      publishers: '发布方',
      records: '记录',
      revenue: '收入',
      reviews: '审核',
      runs: '运行',
    });
    expect(
      Object.fromEntries(
        detailKeys.map((key) => [key, zh[`moduleApps.admin.center.detailNavigation.${key}`]]),
      ),
    ).toEqual({
      configuration: '配置',
      entitlements: '权益',
      overview: '概览',
      products: '商品',
      runtime: '运行状态',
    });
  });
});
