import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import ContextDetailPanel from './ContextDetailPanel';

vi.mock('antd-style', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useResponsive: () => ({ mobile: true }) };
});
vi.mock('@/store/user', () => ({ useUserStore: () => undefined }));
vi.mock('@/store/user/selectors', () => ({ settingsSelectors: { getHotkeyById: () => () => undefined } }));

beforeEach(() => {
  const state = useGlobalStore.getState();
  useGlobalStore.setState({ isStatusInit: true, status: { ...state.status, showLeftPanel: false, showRightPanel: true } });
});

describe('ContextDetailPanel mobile recovery', () => {
  it('closes the full-width detail drawer while reopening the left navigation', () => {
    render(<ContextDetailPanel title="工具详情">工具内容</ContextDetailPanel>);
    const left = screen.getByRole('button', { name: /显示\/隐藏左侧面板|Toggle Left Panel|toggleLeftPanel/i });
    fireEvent.click(left);
    expect(useGlobalStore.getState().status.showLeftPanel).toBe(true);
    expect(useGlobalStore.getState().status.showRightPanel).toBe(false);
    expect(screen.queryByText('工具内容')).not.toBeInTheDocument();
  });

  it('keeps an already-open left navigation open when dismissing the detail drawer', () => {
    const state = useGlobalStore.getState();
    useGlobalStore.setState({ status: { ...state.status, showLeftPanel: true, showRightPanel: true } });
    render(<ContextDetailPanel title="流程详情">流程内容</ContextDetailPanel>);
    fireEvent.click(screen.getByRole('button', { name: /显示\/隐藏左侧面板|Toggle Left Panel|toggleLeftPanel/i }));
    expect(useGlobalStore.getState().status.showLeftPanel).toBe(true);
    expect(useGlobalStore.getState().status.showRightPanel).toBe(false);
  });
});
