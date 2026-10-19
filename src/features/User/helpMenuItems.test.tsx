import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildCustomHelpMenuItems } from './helpMenuItems';

describe('buildCustomHelpMenuItems', () => {
  it('converts backend help menu config to reusable menu items', () => {
    const items = buildCustomHelpMenuItems([
      { label: 'Docs', url: 'https://docs.example.com' },
      { label: 'Support' },
      { label: ' ' },
    ]);

    expect(items).toHaveLength(2);
    const docsItem = items[0]!;
    const supportItem = items[1]!;

    expect(docsItem.key).toBe('custom-help-0');
    expect(supportItem.key).toBe('custom-help-1');

    render(
      <>
        {docsItem.label}
        {supportItem.label}
      </>,
    );

    const docs = screen.getByRole('link', { name: 'Docs' });
    expect(docs).toHaveAttribute('href', 'https://docs.example.com');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('does not render unsafe URL schemes as links while preserving safe URLs', () => {
    const items = buildCustomHelpMenuItems([
      { label: 'Unsafe', url: 'javascript:alert(1)' },
      { label: 'Relative', url: '/docs' },
      { label: 'HTTPS', url: 'https://docs.example.com' },
    ]);

    render(
      <>
        {items.map((item) => (
          <span key={item.key}>{item.label}</span>
        ))}
      </>,
    );

    expect(screen.getByText('Unsafe').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Relative' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('link', { name: 'HTTPS' })).toHaveAttribute(
      'href',
      'https://docs.example.com',
    );
  });
});
