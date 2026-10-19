import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AdminDesktopUpdatePage from './AdminDesktopUpdatePage';

vi.mock('./DesktopControlCenter', () => ({
  default: () => <div data-testid="desktop-control-center" />,
}));

describe('AdminDesktopUpdatePage compatibility entry', () => {
  it('delegates the canonical feature entry to the desktop control center', () => {
    render(<AdminDesktopUpdatePage />);

    expect(screen.getByTestId('desktop-control-center')).toBeInTheDocument();
  });
});
