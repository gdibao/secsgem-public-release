import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import BusinessMobileActionBar, {
  isBusinessMobilePrimaryActionExecutable,
} from './BusinessMobileActionBar';

describe('BusinessMobileActionBar', () => {
  it('renders a full-width executable primary action through a portal', () => {
    const onClick = vi.fn();
    const { container, unmount } = render(
      <BusinessMobileActionBar action={{ label: '升级套餐', onClick }} />,
    );

    const button = screen.getByRole('button', { name: '升级套餐' });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByTestId('business-mobile-action-bar')).toHaveAttribute(
      'data-safe-area',
      'true',
    );
    expect(container).toBeEmptyDOMElement();

    unmount();
    expect(screen.queryByTestId('business-mobile-action-bar')).not.toBeInTheDocument();
  });

  it('renders an executable link action', () => {
    render(<BusinessMobileActionBar action={{ href: '/settings/plans', label: '查看套餐' }} />);

    expect(screen.getByRole('link', { name: '查看套餐' })).toHaveAttribute(
      'href',
      '/settings/plans',
    );
  });

  it('rejects a fixed action without a navigation or click command', () => {
    const action = { label: '暂不可用' };

    expect(isBusinessMobilePrimaryActionExecutable(action)).toBe(false);
    render(<BusinessMobileActionBar action={action} />);
    expect(screen.queryByTestId('business-mobile-action-bar')).not.toBeInTheDocument();
  });

  it('renders nothing during SSR', () => {
    expect(
      renderToString(<BusinessMobileActionBar action={{ label: '升级套餐', onClick: vi.fn() }} />),
    ).toBe('');
  });
});
