import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProductLogo } from './index';

const mocks = vi.hoisted(() => ({
  brand: {
    logoUrl: '/runtime-logo.svg',
    name: 'Runtime Brand',
  },
}));

vi.mock('@lobehub/ui/brand', () => ({
  LobeHub: () => <div data-testid="lobehub-logo" />,
}));

vi.mock('@/const/version', () => ({
  isCustomBranding: false,
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => mocks.brand,
}));

describe('ProductLogo', () => {
  it('uses the runtime brand logo configured by admin before falling back to built-in logos', () => {
    render(<ProductLogo size={32} />);

    expect(screen.getByRole('img', { name: 'Runtime Brand' })).toHaveAttribute(
      'src',
      '/runtime-logo.svg',
    );
    expect(screen.queryByTestId('lobehub-logo')).not.toBeInTheDocument();
  });

  it('treats an empty runtime logo as unset so the auth shell can use the upstream fallback', () => {
    mocks.brand.logoUrl = '';

    render(<ProductLogo size={32} />);

    expect(screen.getByTestId('lobehub-logo')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Runtime Brand' })).not.toBeInTheDocument();
  });
});
