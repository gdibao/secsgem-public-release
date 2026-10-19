import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAppFilter from './ModuleAppFilter';

const moduleApps = vi.hoisted(() => ({
  get: vi
    .fn()
    .mockResolvedValue({ displayName: 'Deep Linked App', id: 'deep-app', slug: 'deep-app' }),
  list: vi.fn().mockResolvedValue({
    items: [
      { displayName: 'Listed App', id: 'listed-app', slug: 'listed-app' },
      { displayName: 'Next App', id: 'next-app', slug: 'next-app' },
    ],
    nextCursor: 'apps-next',
  }),
}));

vi.mock('@/services/adminCommercial', () => ({ adminCommercialService: { moduleApps } }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: 'admin' } }),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    const keyParts = Array.isArray(key) ? key : [];
    if (keyParts[1] === 'detail') {
      return { data: { displayName: 'Deep Linked App', id: 'deep-app', slug: 'deep-app' } };
    }
    return {
      data: {
        items: [
          { displayName: 'Listed App', id: 'listed-app', slug: 'listed-app' },
          { displayName: 'Next App', id: 'next-app', slug: 'next-app' },
        ],
        nextCursor: 'apps-next',
      },
    };
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType = 'button', ...props }: any) => (
    <button type={htmlType} {...props}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
  Select: ({ onChange, options = [], ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

describe('ModuleAppFilter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores a deep-linked app that is outside the first option page', async () => {
    render(
      <MemoryRouter
        initialEntries={['/settings/admin/modules/operations/runs?appId=deep-app&cursor=page-2']}
      >
        <ModuleAppFilter />
      </MemoryRouter>,
    );

    await waitFor(() => expect(moduleApps.get).toHaveBeenCalledWith({ appId: 'deep-app' }));
    expect(screen.getByRole('option', { name: 'Deep Linked App' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('deep-app');

    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.operations.loadMoreApps' }),
    );
    expect(screen.getByRole('combobox')).toHaveValue('deep-app');
  });

  it('clears the cursor trail when changing the selected app', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/settings/admin/modules/operations/runs?appId=listed-app&cursor=page-2&previousCursor=page-1',
        ]}
      >
        <ModuleAppFilter />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('listed-app'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'next-app' } });

    expect(screen.getByRole('combobox')).toHaveValue('next-app');
    expect(screen.getByTestId('location')).toHaveTextContent('appId=next-app');
    expect(screen.getByTestId('location')).not.toHaveTextContent('cursor');
  });
});
