// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import McpDetailPage from './index';

const mocks = vi.hoisted(() => ({
  useFetchMcpDetail: vi.fn(),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'open%2Fmcp' }),
}));

vi.mock('@/features/MCPPluginDetail/DetailProvider', () => ({
  DetailProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/MCPPluginDetail/Header', () => ({
  default: () => <div>mcp header</div>,
}));

vi.mock('@/hooks/useFetchInstalledPlugins', () => ({
  useFetchInstalledPlugins: vi.fn(),
}));

vi.mock('@/hooks/useQuery', () => ({
  useQuery: () => ({}),
}));

vi.mock('@/store/discover', () => ({
  useDiscoverStore: (selector: (state: { useFetchMcpDetail: typeof mocks.useFetchMcpDetail }) => unknown) =>
    selector({ useFetchMcpDetail: mocks.useFetchMcpDetail }),
}));

vi.mock('../features/Toc/useToc', () => ({
  TocProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./features/Details', () => ({
  default: () => <div data-testid="mcp-details" />,
}));

vi.mock('./loading', () => ({
  default: () => <div>loading</div>,
}));

describe('McpDetailPage', () => {
  it('decodes encoded community mcp identifiers before fetching details', () => {
    mocks.useFetchMcpDetail.mockReturnValue({
      data: { identifier: 'open/mcp' },
      isLoading: false,
    });

    render(<McpDetailPage />);

    expect(mocks.useFetchMcpDetail).toHaveBeenCalledWith({ identifier: 'open/mcp', version: undefined });
    expect(screen.getByTestId('mcp-details')).toBeInTheDocument();
  });
});
