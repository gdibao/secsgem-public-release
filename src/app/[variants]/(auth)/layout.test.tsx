import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AuthLayout from './layout';

const mocks = vi.hoisted(() => ({
  brand: {
    authTitle: 'Admin auth title',
    copyrightText: 'Copyright 2026 ComHub',
    logoUrl: '/runtime-auth-logo.svg',
    name: 'ComHub Runtime',
  },
  brandProvider: vi.fn(({ children }: { children: React.ReactNode }) => <div>{children}</div>),
  getServerBrand: vi.fn(),
}));

vi.mock('@/server/services/brand', () => ({
  getServerBrand: mocks.getServerBrand,
}));

vi.mock('@/features/Brand', () => ({
  BrandProvider: mocks.brandProvider,
}));

vi.mock('./_layout/AuthGlobalProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/client/ClientOnly', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('nuqs/adapters/next/app', () => ({
  NuqsAdapter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/business/client/BusinessAuthProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./_layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

describe('AuthLayout', () => {
  it('passes the server brand settings into the upstream auth shell provider', async () => {
    mocks.getServerBrand.mockResolvedValueOnce(mocks.brand);

    render(
      await AuthLayout({
        children: <div>auth page</div>,
        params: Promise.resolve({ variants: 'zh-CN__0' }),
      } as any),
    );

    expect(mocks.getServerBrand).toHaveBeenCalledTimes(1);
    expect(mocks.brandProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        initialBrand: mocks.brand,
        updateDocumentTitle: false,
      }),
      undefined,
    );
    expect(screen.getByText('auth page')).toBeInTheDocument();
  });
});
