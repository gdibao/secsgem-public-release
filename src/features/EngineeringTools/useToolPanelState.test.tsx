import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolPanelState,useToolPanelState } from './useToolPanelState';

const fixture = vi.hoisted(() => ({
  currentWorkspace: 'w1',
  deferred: null as null | { resolve: (value: { version: number }) => void },
  saves: [] as Array<{ activeTabId: string | null; expectedVersion: number; panelOpen: boolean; tabs: Array<{ id: string; toolId: string }> }>,
  states: new Map<string, ToolPanelState>(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => fixture.currentWorkspace }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: true }) }));
vi.mock('swr', () => ({ default: (key: string[] | null) => {
  const scope = key?.[1] ?? '';
  return { data: key ? fixture.states.get(scope) : undefined, error: undefined, isLoading: false,
    mutate: async (value?: ToolPanelState) => {
      if (value) fixture.states.set(scope, value);
      return fixture.states.get(scope);
    } };
} }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: {
  listPanelState: { query: vi.fn() },
  savePanelState: { mutate: async (input: { activeTabId: string | null; expectedVersion: number; panelOpen: boolean; tabs: Array<{ id: string; toolId: string }> }) => {
    fixture.saves.push(input);
    if (fixture.saves.length === 1 && fixture.deferred) return new Promise<{ version: number }>((resolve) => { fixture.deferred!.resolve = resolve; });
    return { version: input.expectedVersion + 1 };
  } },
} } }));

const empty = (): ToolPanelState => ({ activeTabId: null, panelOpen: false, tabs: [], version: 0, width: null });

describe('useToolPanelState', () => {
  beforeEach(() => {
    fixture.currentWorkspace = 'w1'; fixture.deferred = null; fixture.saves = [];
    fixture.states.clear(); fixture.states.set('user-a:w1', empty()); fixture.states.set('user-a:w2', empty());
  });

  it('replays B on top of A while the first save is in flight', async () => {
    fixture.deferred = { resolve: () => undefined };
    const { result } = renderHook(() => useToolPanelState());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.open('TOOL-A'));
    await waitFor(() => expect(fixture.saves).toHaveLength(1));
    act(() => result.current.open('TOOL-B', 'runtime'));
    expect(result.current.state.tabs.map((tab) => tab.toolId)).toEqual(['TOOL-A', 'TOOL-B']);
    await act(async () => fixture.deferred!.resolve({ version: 1 }));
    await waitFor(() => expect(fixture.saves).toHaveLength(2));
    expect(fixture.saves[1].tabs.map((tab) => tab.toolId)).toEqual(['TOOL-A', 'TOOL-B']);
    await waitFor(() => expect(result.current.state.version).toBe(2));
    expect(result.current.state.tabs.map((tab) => tab.toolId)).toEqual(['TOOL-A', 'TOOL-B']);
    expect(result.current.state.activeTabId).toBe(result.current.state.tabs[1].id);
  });

  it('ignores old-workspace responses after a scope switch', async () => {
    fixture.deferred = { resolve: () => undefined };
    const { result, rerender } = renderHook(() => useToolPanelState());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.open('TOOL-A'));
    await waitFor(() => expect(fixture.saves).toHaveLength(1));
    fixture.currentWorkspace = 'w2';
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.open('TOOL-C'));
    await waitFor(() => expect(result.current.state.tabs.map((tab) => tab.toolId)).toEqual(['TOOL-C']));
    await act(async () => fixture.deferred!.resolve({ version: 1 }));
    expect(result.current.state.tabs.map((tab) => tab.toolId)).toEqual(['TOOL-C']);
    expect(result.current.state.activeTabId).toBe(result.current.state.tabs[0].id);
  });

  it('evicts the oldest closed history item to open a thirty-first tool', async () => {
    const tabs = Array.from({ length: 30 }, (_, index) => ({
      closed: true, endpointId: null, id: `tab-${index}`, kind: 'detail' as const, toolId: `TOOL-${index}`,
    }));
    fixture.states.set('user-a:w1', { ...empty(), tabs });
    const { result } = renderHook(() => useToolPanelState());
    act(() => result.current.open('TOOL-30'));
    await waitFor(() => expect(result.current.state.tabs.some((tab) => tab.toolId === 'TOOL-30')).toBe(true));
    expect(result.current.state.tabs).toHaveLength(30);
    expect(result.current.state.tabs.some((tab) => tab.id === 'tab-0')).toBe(false);
    expect(result.current.failure).toBe('');
  });

  it('explains the limit when all thirty tabs remain open', () => {
    const tabs = Array.from({ length: 30 }, (_, index) => ({
      closed: false, endpointId: null, id: `tab-${index}`, kind: 'detail' as const, toolId: `TOOL-${index}`,
    }));
    fixture.states.set('user-a:w1', { ...empty(), activeTabId: 'tab-29', panelOpen: true, tabs });
    const { result } = renderHook(() => useToolPanelState());
    act(() => result.current.open('TOOL-30'));
    expect(result.current.state.tabs).toHaveLength(30);
    expect(result.current.failure).toMatch(/最多同时打开 30 个工具/);
    expect(fixture.saves).toHaveLength(0);
  });

  it('restores both tabs and the active tab after the page hook remounts', async () => {
    const first = renderHook(() => useToolPanelState());
    act(() => first.result.current.open('TOOL-A'));
    await waitFor(() => expect(first.result.current.state.version).toBe(1));
    act(() => first.result.current.open('TOOL-B', 'runtime'));
    await waitFor(() => expect(first.result.current.state.version).toBe(2));
    const selected = first.result.current.state.activeTabId;
    first.unmount();
    const second = renderHook(() => useToolPanelState());
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.state.tabs.map((tab) => tab.toolId)).toEqual(['TOOL-A', 'TOOL-B']);
    expect(second.result.current.state.activeTabId).toBe(selected);
  });
});
