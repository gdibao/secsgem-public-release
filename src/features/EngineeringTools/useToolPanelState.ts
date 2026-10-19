import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { v4 as uuidv4 } from 'uuid';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';

export interface ToolTab {
  closed: boolean;
  endpointId: string | null;
  id: string;
  kind: 'detail' | 'runtime';
  toolId: string;
}
export interface ToolPanelState {
  activeTabId: string | null;
  panelOpen: boolean;
  tabs: ToolTab[];
  version: number;
  width: number | null;
}

type Operation = { apply: (state: ToolPanelState) => ToolPanelState; kind: 'width' | 'other' | 'open' };
type Machine = { committed?: ToolPanelState; operations: Operation[]; running: boolean; scope: string | null };
const empty: ToolPanelState = { activeTabId: null, panelOpen: false, tabs: [], version: 0, width: null };
const replay = (state: ToolPanelState, operations: Operation[]) => operations.reduce((value, operation) => operation.apply(value), state);

export const useToolPanelState = () => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { ready } = useEngineeringWorkspaceScope();
  const scope = ready && userId ? `${userId}:${workspaceId ?? 'global'}` : null;
  const { data, error, isLoading, mutate } = useSWR<ToolPanelState>(
    scope ? ['engineering-tool-panel-state', scope] : null,
    () => lambdaClient.engineeringTools.listPanelState.query(),
  );
  const [local, setLocal] = useState<{ scope: string; state: ToolPanelState }>();
  const [failure, setFailure] = useState('');
  const machineRef = useRef<Machine>({ operations: [], running: false, scope });
  if (machineRef.current.scope !== scope) machineRef.current = { operations: [], running: false, scope };
  const machine = machineRef.current;

  useEffect(() => {
    if (!scope || !data || machineRef.current !== machine) return;
    if (!machine.committed || data.version > machine.committed.version) {
      machine.committed = data;
      setLocal({ scope, state: replay(data, machine.operations) });
    }
  }, [data, machine, scope]);

  const flush = async (targetMachine: Machine) => {
    if (targetMachine.running) return;
    targetMachine.running = true;
    while (targetMachine.operations.length && targetMachine === machineRef.current && targetMachine.committed) {
      const operation = targetMachine.operations[0];
      const previous = targetMachine.committed;
      const target = operation.apply(previous);
      if (target === previous) { targetMachine.operations.shift(); continue; }
      try {
        const result = await lambdaClient.engineeringTools.savePanelState.mutate({
          activeTabId: target.activeTabId, expectedVersion: previous.version,
          panelOpen: target.panelOpen, tabs: target.tabs, width: target.width,
        });
        if (targetMachine !== machineRef.current) break;
        targetMachine.committed = { ...target, version: result.version };
        targetMachine.operations.shift();
        setLocal({ scope: targetMachine.scope!, state: replay(targetMachine.committed, targetMachine.operations) });
        await mutate(targetMachine.committed, { revalidate: false });
      } catch (cause) {
        if (targetMachine !== machineRef.current) break;
        const fresh = await mutate().catch(() => undefined);
        if (fresh && fresh.version !== previous.version) {
          targetMachine.committed = fresh;
          setLocal({ scope: targetMachine.scope!, state: replay(fresh, targetMachine.operations) });
          continue;
        }
        targetMachine.operations = [];
        if (fresh) { targetMachine.committed = fresh; setLocal({ scope: targetMachine.scope!, state: fresh }); }
        setFailure(cause instanceof Error ? cause.message : '标签保存失败，请刷新重试');
      }
    }
    targetMachine.running = false;
  };

  const change = (operation: Operation) => {
    if (!scope || !data || machineRef.current !== machine) return;
    if (!machine.committed) machine.committed = data;
    const before = replay(machine.committed, machine.operations);
    if (operation.kind === 'open' && operation.apply(before) === before) {
      setFailure('最多同时打开 30 个工具，请先关闭一个标签。');
      return;
    }
    const firstPending = machine.running ? 1 : 0;
    const last = machine.operations.at(-1);
    if (operation.kind === 'width' && last?.kind === 'width' && machine.operations.length > firstPending)
      machine.operations[machine.operations.length - 1] = operation;
    else machine.operations.push(operation);
    setLocal({ scope, state: replay(machine.committed, machine.operations) });
    setFailure('');
    void flush(machine);
  };

  const open = (toolId: string, kind: ToolTab['kind'] = 'detail', endpointId: string | null = null) => {
    const id = uuidv4();
    change({ kind: 'open', apply: (state) => {
      const existing = state.tabs.find((tab) => tab.toolId === toolId && tab.kind === kind && !tab.closed)
        ?? state.tabs.find((tab) => tab.toolId === toolId && tab.kind === kind);
      if (existing) return { ...state, activeTabId: existing.id, panelOpen: true,
        tabs: state.tabs.map((tab) => tab.id === existing.id ? { ...tab, closed: false, endpointId: endpointId ?? tab.endpointId } : tab) };
      const tabs = state.tabs.length >= 30
        ? state.tabs.filter((_, index) => index !== state.tabs.findIndex((tab) => tab.closed))
        : state.tabs;
      if (tabs.length >= 30) return state;
      return { ...state, activeTabId: id, panelOpen: true,
        tabs: [...tabs, { closed: false, endpointId, id, kind, toolId }] };
    } });
  };
  const select = (id: string) => change({ kind: 'other', apply: (state) => state.tabs.some((tab) => tab.id === id && !tab.closed)
    ? { ...state, activeTabId: id, panelOpen: true } : state });
  const close = (id: string) => change({ kind: 'other', apply: (state) => {
    const tabs = state.tabs.map((tab) => tab.id === id ? { ...tab, closed: true } : tab);
    return { ...state, activeTabId: state.activeTabId === id ? tabs.findLast((tab) => !tab.closed)?.id ?? null : state.activeTabId, tabs };
  } });
  const reopen = (id: string) => change({ kind: 'other', apply: (state) => state.tabs.some((tab) => tab.id === id && tab.closed)
    ? { ...state, activeTabId: id, panelOpen: true,
      tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, closed: false } : tab) } : state });
  const setKind = (id: string, kind: ToolTab['kind']) => change({ kind: 'other', apply: (state) => ({
    ...state, tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, kind } : tab),
  }) });
  const setEndpoint = (id: string, endpointId: string | null) => change({ kind: 'other', apply: (state) => ({
    ...state, tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, endpointId } : tab),
  }) });
  const setPanelOpen = (panelOpen: boolean) => change({ kind: 'other', apply: (state) => ({ ...state, panelOpen }) });
  const setWidth = (width: number) => change({ kind: 'width', apply: (state) => ({
    ...state, width: Math.min(4096, Math.max(300, Math.round(width))),
  }) });

  return { close, error, failure, isLoading, open, ready: !!scope && !!data, reopen,
    refresh: mutate, select, setEndpoint, setKind, setPanelOpen, setWidth,
    state: scope && local?.scope === scope ? local.state : scope ? data ?? empty : empty };
};
