import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import AdminSidebar from './AdminSidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? key),
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: 'admin' } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userProfile: (state: { user: unknown }) => state.user,
  },
}));

describe('AdminSidebar', () => {
  it('uses the search input as the only search label', () => {
    render(
      <MemoryRouter initialEntries={['/settings/admin']}>
        <AdminSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('searchbox', { name: '搜索管理功能' })).toBeInTheDocument();
    expect(screen.queryByText('搜索管理功能')).not.toBeInTheDocument();
  });
});
