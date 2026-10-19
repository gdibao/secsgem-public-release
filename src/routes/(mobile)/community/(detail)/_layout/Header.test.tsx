import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ onBackClick }: { onBackClick: () => void }) => (
    <button type="button" onClick={onBackClick}>
      Back
    </button>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

import Header from './Header';

describe('MobileCommunityDetailHeader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a workspace detail page to its community list', () => {
    render(
      <MemoryRouter initialEntries={['/acme/community/agent/example']}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(navigate).toHaveBeenCalledWith('/community/agent');
  });

  it('returns group assistant details to the assistant list', () => {
    render(
      <MemoryRouter initialEntries={['/community/group_agent/example']}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(navigate).toHaveBeenCalledWith('/community/agent');
  });
});
