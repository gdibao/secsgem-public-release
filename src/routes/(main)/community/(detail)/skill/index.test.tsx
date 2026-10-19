// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SkillDetailPage from './index';

const mocks = vi.hoisted(() => ({
  useFetchSkillDetail: vi.fn(),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'open%2Fskill' }),
}));

vi.mock('@/hooks/useQuery', () => ({
  useQuery: () => ({}),
}));

vi.mock('@/store/discover', () => ({
  useDiscoverStore: (selector: (state: { useFetchSkillDetail: typeof mocks.useFetchSkillDetail }) => unknown) =>
    selector({ useFetchSkillDetail: mocks.useFetchSkillDetail }),
}));

vi.mock('../features/Toc/useToc', () => ({
  TocProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./features/DetailProvider', () => ({
  DetailProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./features/Header', () => ({
  default: () => <div>skill header</div>,
}));

vi.mock('./features/Details', () => ({
  default: () => <div data-testid="skill-details" />,
}));

vi.mock('./loading', () => ({
  default: () => <div>loading</div>,
}));

describe('SkillDetailPage', () => {
  it('decodes encoded community skill identifiers before fetching details', () => {
    mocks.useFetchSkillDetail.mockReturnValue({
      data: { identifier: 'open/skill' },
      isLoading: false,
    });

    render(<SkillDetailPage />);

    expect(mocks.useFetchSkillDetail).toHaveBeenCalledWith({ identifier: 'open/skill', version: undefined });
    expect(screen.getByTestId('skill-details')).toBeInTheDocument();
  });
});
