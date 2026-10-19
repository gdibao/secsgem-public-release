import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import About from './About';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Form: {
    Group: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <section>
        <h1>{title}</h1>
        {children}
      </section>
    ),
  },
}));

vi.mock('antd', () => ({
  Divider: () => <hr />,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ title: 'title' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        about: 'About',
        contact: 'Contact',
        information: 'Information',
        legal: 'Legal',
        version: 'Version',
      })[key] ?? key,
  }),
}));

vi.mock('swr', () => ({
  default: () => ({
    data: {
      links: {
        contact: [
          { id: 'officialSite', label: 'Runtime portal', url: 'https://chat.example.com' },
        ],
        information: [{ id: 'github', label: 'Runtime repo', url: 'https://git.example.com' }],
        legal: [{ id: 'terms', label: 'Runtime terms', url: 'https://terms.example.com' }],
      },
      logoUrl: '/about/logo.png',
    },
  }),
}));

vi.mock('@/features/Brand', () => ({
  useBrand: () => ({ logoUrl: '/brand/logo.svg' }),
  useBrandName: () => 'Runtime Brand',
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      settings: {
        getPublicAboutLinks: {
          query: vi.fn(),
        },
      },
    },
  },
}));

vi.mock('./AboutList', () => ({
  default: ({ ItemRender, items }: { ItemRender: React.ComponentType<any>; items: any[] }) => (
    <div>
      {items.map((item) => (
        <ItemRender key={item.value} {...item} />
      ))}
    </div>
  ),
}));

vi.mock('./ItemCard', () => ({
  default: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
}));

vi.mock('./ItemLink', () => ({
  default: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
}));

vi.mock('./Version', () => ({
  default: ({ logoUrl }: { logoUrl?: string | null }) => (
    <div>{logoUrl ? <img alt="Runtime Brand" src={logoUrl} /> : 'Version block'}</div>
  ),
}));

describe('About', () => {
  it('renders the runtime brand and admin-configured public about links', () => {
    render(<About />);

    expect(screen.getByRole('heading', { name: 'About Runtime Brand' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runtime portal' })).toHaveAttribute(
      'href',
      'https://chat.example.com',
    );
    expect(screen.getByRole('link', { name: 'Runtime repo' })).toHaveAttribute(
      'href',
      'https://git.example.com',
    );
    expect(screen.getByRole('link', { name: 'Runtime terms' })).toHaveAttribute(
      'href',
      'https://terms.example.com',
    );
    expect(screen.getByAltText('Runtime Brand')).toHaveAttribute('src', '/about/logo.png');
  });
});
