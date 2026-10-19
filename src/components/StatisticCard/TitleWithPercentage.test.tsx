/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TitleWithPercentage from './TitleWithPercentage';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Text: ({
    children,
    ellipsis,
    title,
  }: {
    children: ReactNode;
    ellipsis?: { rows?: number; tooltip?: unknown };
    title?: string;
  }) => (
    <h2 data-has-tooltip={String(Boolean(ellipsis?.tooltip))} title={title}>
      {children}
    </h2>
  ),
}));

describe('TitleWithPercentage', () => {
  it('uses a native title without creating an ellipsis tooltip', () => {
    render(<TitleWithPercentage title="Monthly usage" />);

    const heading = screen.getByRole('heading', { name: 'Monthly usage' });
    expect(heading).toHaveAttribute('title', 'Monthly usage');
    expect(heading).toHaveAttribute('data-has-tooltip', 'false');
  });
});
