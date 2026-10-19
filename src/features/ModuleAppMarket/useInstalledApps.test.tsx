import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInstalledApps } from './useInstalledApps';

const serviceMocks = vi.hoisted(() => ({
  listMyApps: vi.fn(),
  listTeamApps: vi.fn(),
}));
const swrState = vi.hoisted(() => ({
  data: undefined as
    | Array<{
        items: Array<{ displayName: string; id: string }>;
        nextCursor: null | number;
      }>
    | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  setSize: vi.fn(),
  size: 1,
}));
const swrCapture = vi.hoisted(() => ({
  fetcher: undefined as ((key: readonly unknown[]) => Promise<unknown>) | undefined,
  getKey: undefined as ((pageIndex: number, previousPageData: unknown) => unknown) | undefined,
}));

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: serviceMocks,
}));
vi.mock('swr/infinite', () => ({
  default: (getKey: typeof swrCapture.getKey, fetcher: typeof swrCapture.fetcher) => {
    swrCapture.getKey = getKey;
    swrCapture.fetcher = fetcher;
    return swrState;
  },
}));

describe('useInstalledApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.data = undefined;
    swrState.error = undefined;
    swrState.isLoading = false;
    swrState.isValidating = false;
    swrState.size = 1;
  });

  it('builds bounded personal and workspace page requests and stops at the final page', async () => {
    type HookProps = {
      query: string;
      scope: 'personal' | 'workspace';
      workspaceId?: string;
    };
    const initialProps: HookProps = {
      query: '  record desk  ',
      scope: 'personal',
      workspaceId: undefined,
    };
    const { rerender } = renderHook(
      ({ query, scope, workspaceId }: HookProps) => useInstalledApps({ query, scope, workspaceId }),
      {
        initialProps,
      },
    );
    const personalKey = swrCapture.getKey!(0, null) as readonly unknown[];
    expect(personalKey).toEqual(['moduleApp.listMyApps', null, 'record desk', 0]);
    await swrCapture.fetcher!(personalKey);
    expect(serviceMocks.listMyApps).toHaveBeenCalledWith({
      cursor: 0,
      limit: 20,
      query: 'record desk',
    });
    expect(swrCapture.getKey!(1, { items: [], nextCursor: null })).toBeNull();

    rerender({ query: 'shared', scope: 'workspace', workspaceId: 'workspace-1' });
    const workspaceKey = swrCapture.getKey!(1, { items: [], nextCursor: 20 }) as readonly unknown[];
    await swrCapture.fetcher!(workspaceKey);
    expect(serviceMocks.listTeamApps).toHaveBeenCalledWith({
      cursor: 20,
      limit: 20,
      query: 'shared',
      workspaceId: 'workspace-1',
    });
    expect(swrState.setSize).toHaveBeenCalledWith(1);
  });

  it('deduplicates pages and loads the next cursor page once', () => {
    swrState.data = [
      {
        items: [
          { displayName: 'Alpha', id: 'app-1' },
          { displayName: 'Beta', id: 'app-2' },
        ],
        nextCursor: 2,
      },
      {
        items: [
          { displayName: 'Beta updated', id: 'app-2' },
          { displayName: 'Gamma', id: 'app-3' },
        ],
        nextCursor: 4,
      },
    ];
    swrState.size = 2;

    const { result } = renderHook(() => useInstalledApps({ query: '', scope: 'personal' }));

    expect(result.current.items.map((item) => item.displayName)).toEqual([
      'Alpha',
      'Beta updated',
      'Gamma',
    ]);
    act(() => result.current.loadMore());
    expect(swrState.setSize).toHaveBeenLastCalledWith(3);
  });
});
