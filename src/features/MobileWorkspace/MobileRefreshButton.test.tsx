import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileRefreshButton from './MobileRefreshButton';

vi.mock('@lobehub/ui', () => ({ Icon: () => <span aria-hidden="true" /> }));

describe('MobileRefreshButton', () => {
  it('exposes refresh progress and prevents duplicate actions', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <MobileRefreshButton label="Refresh" loading={false} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<MobileRefreshButton label="Refresh" loading onRefresh={onRefresh} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
  });
});
