import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AuthContainer from './index';

const mocks = vi.hoisted(() => ({
  brand: {
    copyrightText: 'Copyright 2026 ComHub',
    logoUrl: '/runtime-auth-logo.svg',
    name: 'ComHub Runtime',
  },
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => mocks.brand,
}));

vi.mock('@/components/Branding', () => ({
  ProductLogo: () => <img alt={mocks.brand.name} src={mocks.brand.logoUrl} />,
}));

vi.mock('@/hooks/useIsDark', () => ({
  useIsDark: () => false,
}));

vi.mock('./AuthLangButton', () => ({
  default: () => <button type="button">Lang</button>,
}));

vi.mock('./AuthThemeButton', () => ({
  default: () => <button type="button">Theme</button>,
}));

vi.mock('./AuthFooterLinks', () => ({
  default: () => <span>Terms · Privacy</span>,
}));

describe('AuthContainer', () => {
  it('keeps branding inside the upstream auth shell without replacing its footer', () => {
    render(
      <AuthContainer>
        <div>auth form</div>
      </AuthContainer>,
    );

    expect(screen.getByRole('link', { name: 'ComHub Runtime' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('img', { name: 'ComHub Runtime' })).toHaveAttribute(
      'src',
      '/runtime-auth-logo.svg',
    );
    expect(screen.getByText('Terms · Privacy')).toBeInTheDocument();
    expect(screen.queryByText('Copyright 2026 ComHub')).not.toBeInTheDocument();
  });
});
