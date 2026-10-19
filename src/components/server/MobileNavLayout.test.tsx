import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MobileContentLayout from './MobileNavLayout';

describe('MobileContentLayout', () => {
  it('lets the scroll region fill the space below a mobile header', () => {
    render(
      <MobileContentLayout header={<div>Header</div>}>
        <div>Content</div>
      </MobileContentLayout>,
    );

    const scrollRegion = screen.getByTestId('mobile-content-scroll');

    expect(scrollRegion).not.toHaveStyle({ height: '100%' });
    expect(scrollRegion).toHaveStyle({ flex: '1 1 0%', minHeight: '0' });
  });

  it('preserves a caller-provided scroll container id below a mobile header', () => {
    render(
      <MobileContentLayout header={<div>Header</div>} id="discover-scroll">
        <div>Content</div>
      </MobileContentLayout>,
    );

    expect(screen.getByTestId('mobile-content-scroll')).toHaveAttribute('id', 'discover-scroll');
  });
});
