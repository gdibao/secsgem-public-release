import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ModulePageState } from './ModulePageState';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    htmlType,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; htmlType?: 'button' }) => (
    <button type={htmlType} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'moduleApps.admin.center.state.clearFilters': 'Clear filters',
        'moduleApps.admin.center.state.emptyFilteredDescription': 'Change or clear filters.',
        'moduleApps.admin.center.state.emptyFilteredTitle': 'No matching results',
        'moduleApps.admin.center.state.emptyInitialDescription': 'Create the first item.',
        'moduleApps.admin.center.state.emptyInitialTitle': 'Nothing here yet',
        'moduleApps.admin.center.state.loadErrorDescription': 'Try loading this section again.',
        'moduleApps.admin.center.state.loadErrorTitle': 'Could not load this section',
        'moduleApps.admin.center.state.loading': 'Loading module data',
        'moduleApps.admin.center.state.retry': 'Retry',
      })[key] ?? key,
  }),
}));

describe('ModulePageState', () => {
  it('renders stable list and detail skeletons without a spinner', () => {
    const { rerender } = render(
      <ModulePageState loading isEmpty={false} skeletonVariant="list">
        content
      </ModulePageState>,
    );

    expect(screen.getByTestId('module-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    rerender(
      <ModulePageState loading isEmpty={false} skeletonVariant="detail">
        content
      </ModulePageState>,
    );
    expect(screen.getByTestId('module-detail-skeleton')).toBeInTheDocument();
  });

  it('distinguishes filtered empty state and clears filters', () => {
    const onClearFilters = vi.fn();

    render(
      <ModulePageState isEmpty emptyKind="filtered" onClearFilters={onClearFilters}>
        content
      </ModulePageState>,
    );

    expect(screen.getByText('No matching results')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it('offers retry from the error state', () => {
    const onRetry = vi.fn();

    render(
      <ModulePageState error={new Error('network')} isEmpty={false} onRetry={onRetry}>
        content
      </ModulePageState>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
