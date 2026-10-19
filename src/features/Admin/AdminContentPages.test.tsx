import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTopicsPage } from './AdminContentPages';

const swrMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr', () => swrMock);
vi.mock('@/components/InlineTable', () => ({
  default: ({ dataSource = [] }: { dataSource?: unknown[] }) => (
    <div data-testid="content-table">{dataSource.length} rows</div>
  ),
}));
vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    archiveAdminTopic: vi.fn(),
    deleteAdminDocument: vi.fn(),
    deleteAdminFile: vi.fn(),
    deleteAdminTopic: vi.fn(),
    listAdminDocuments: vi.fn(),
    listAdminFiles: vi.fn(),
    listAdminTopics: vi.fn(),
  },
}));

beforeEach(() => {
  swrMock.mutate.mockReset();
  swrMock.useClientDataSWR.mockReset();
});

describe('AdminContentPages', () => {
  it('uses the shared admin hierarchy and exposes a named data region', () => {
    swrMock.useClientDataSWR.mockReturnValue({
      data: { items: [], nextCursor: null },
      error: undefined,
      isLoading: false,
    });

    render(<AdminTopicsPage />);

    expect(screen.getByRole('heading', { level: 1, name: '话题管理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '话题列表' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '话题数据表' })).toBeInTheDocument();
  });

  it('shows a retry action when content data fails to load', () => {
    swrMock.useClientDataSWR.mockReturnValue({
      data: undefined,
      error: new Error('network unavailable'),
      isLoading: false,
    });

    render(<AdminTopicsPage />);

    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(swrMock.mutate).toHaveBeenCalledWith(['admin-content', 'topics', 0, '', '', '', '']);
  });
});
