import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { createStaticStyles, useResponsive } from 'antd-style';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import EngineeringToolsPage, { getDetailMaxWidth } from './EngineeringToolsPage';

const fixture = vi.hoisted(() => ({
  mobile: false,
  open: vi.fn(),
  reopen: vi.fn(),
  mounts: [] as string[],
  workspaceId: 'w1',
  resolveLate: undefined as undefined | ((value: string) => void),
  ready: true,
  state: { activeTabId: null as string | null, panelOpen: false,
    tabs: [] as Array<{ closed: boolean; endpointId: null; id: string; kind: 'detail' | 'runtime'; toolId: string }>,
    version: 0, width: null },
}));
vi.mock('antd-style', async (importOriginal) => ({
  ...await importOriginal<{ createStaticStyles: typeof createStaticStyles; useResponsive: typeof useResponsive }>(),
  useResponsive: () => ({ mobile: fixture.mobile }),
}));
const longSummary = '这段工具介绍包含输入条件、计算步骤和输出结果。'.repeat(8);
const tools = [
  { availability: '未安装', category: '管路', description: '', developerOnly: false, enabled: true, id: 'PG001', license: '待核', name: '工艺工具', section: 'process', shape: 'web', sortOrder: 1, sourceUrl: 'https://example.com/process', summary: longSummary },
  { availability: '未安装', category: '控制', description: '', developerOnly: true, enabled: true, id: 'AN001', license: '待核', name: '自动化扩展', section: 'automation', shape: 'sdk', sortOrder: 2, sourceUrl: 'https://example.com/automation', summary: '自动化扩展' },
  { availability: '不可用', category: '设计', description: '', developerOnly: false, enabled: false, id: 'DQ001', license: '待核', name: '归档工具', publicReason: '许可未核', section: 'design', shape: 'windows', sortOrder: 3, sourceUrl: 'https://example.com/design', summary: '归档工具' },
];

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ getActiveWorkspaceId: () => fixture.workspaceId, useActiveWorkspaceId: () => fixture.workspaceId }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: fixture.ready }) }));
vi.mock('./useToolPanelState', () => ({ useToolPanelState: () => ({
  close: vi.fn(), failure: '', open: fixture.open, ready: fixture.ready, reopen: fixture.reopen,
  select: vi.fn(), setEndpoint: vi.fn(), setKind: vi.fn(), setPanelOpen: vi.fn(), setWidth: vi.fn(),
  state: fixture.state,
}) }));
vi.mock('./FavoriteControl', () => ({ default: () => <button type="button">加入收藏</button> }));
vi.mock('./WorkspaceView', () => ({ default: ({ view }: { view: string }) => <div>视图 {view}</div> }));
vi.mock('./CommunityPanel', () => ({ default: function MockCommunityPanel() {
  const [draft, setDraft] = useState('');
  return <div>工具社区表单<input aria-label="投稿名称" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button onClick={() => void new Promise<string>((resolve) => { fixture.resolveLate = resolve; }).then(setDraft)}>模拟迟到响应</button></div>;
} }));
vi.mock('./RatingControl', () => ({ default: () => <div>用户评分</div> }));
vi.mock('./LaunchPanel', () => ({ default: function MockLaunchPanel({ toolId }: { toolId: string }) {
  const [mount] = useState(() => { fixture.mounts.push(toolId); return fixture.mounts.length; });
  const [value, setValue] = useState(0);
  return <button data-testid={`runtime-${toolId}`} onClick={() => setValue((current) => current + 1)}>{toolId} 本地状态 {value} 挂载 {mount}</button>;
} }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: {
  listCatalog: { query: vi.fn() }, menu: { query: vi.fn() }, vocabulary: { query: vi.fn() },
} } }));
vi.mock('swr', () => ({ default: (key: string | string[] | null) => ({
  data: Array.isArray(key) && key[0] === 'engineering-tools-catalog' ? { items: tools, total: 3 } : undefined,
  error: undefined, isLoading: false, mutate: vi.fn(),
}) }));

describe('EngineeringToolsPage', () => {
  it('reserves main content width inside the Fab navigation, while retaining wide and full-width options', () => {
    expect(getDetailMaxWidth(1176)).toBe(756);
    expect(getDetailMaxWidth(1656)).toBe(1236);
    expect(getDetailMaxWidth(600)).toBe(320);
  });

  beforeEach(() => {
    fixture.mobile = false;
    fixture.ready = true;
    fixture.workspaceId = 'w1';
    fixture.resolveLate = undefined;
    fixture.open.mockClear();
    fixture.reopen.mockClear();
    fixture.mounts = [];
    fixture.state.activeTabId = null;
    fixture.state.panelOpen = false;
    fixture.state.tabs = [];
    const state = useGlobalStore.getState();
    useGlobalStore.setState({ isStatusInit: true, status: { ...state.status, showLeftPanel: false, showRightPanel: false } });
  });

  it('shows every section by default, including developer and archived records', () => {
    render(<MemoryRouter initialEntries={['/engineering-tools?section=process']}><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '全部工程工具' })).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 3 项/)).toBeInTheDocument();
    expect(screen.getAllByText('自动化扩展').length).toBeGreaterThan(0);
    expect(screen.getAllByText('归档工具').length).toBeGreaterThan(0);
    expect(screen.getByText(/历史归档 · 许可未核/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '归档不可启动' })).toBeDisabled();
  });

  it('keeps mobile advanced facets collapsed until requested', async () => {
    fixture.mobile = true;
    render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '展开筛选' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('textbox', { name: '搜索工具' })).toBeInTheDocument();
    expect(screen.queryByLabelText('分类范围')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('开发与扩展')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '投稿与审核' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('工作阶段')).not.toBeInTheDocument();
    expect(screen.getAllByText('工艺工具').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    expect(screen.getByRole('button', { name: '收起筛选' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('分类范围')).toBeInTheDocument();
    expect(screen.getByLabelText('开发与扩展')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '投稿与审核' })).toBeInTheDocument();
    expect(screen.getByLabelText('工作阶段')).toBeInTheDocument();
    expect(screen.getByText('清除筛选')).toBeInTheDocument();
    expect(screen.queryByLabelText('维护组织')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('开发与扩展'));
    await userEvent.click(screen.getByRole('button', { name: '收起筛选' }));
    expect(screen.getByRole('button', { name: '展开筛选（1）' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: '展开筛选（1）' }));
    await userEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByLabelText('开发与扩展')).toBeChecked();
  });

  it('does not offer maintainer as a desktop catalog filter', () => {
    render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByLabelText('分类范围')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '投稿与审核' })).toBeInTheDocument();
    expect(screen.getByLabelText('子系统')).toBeInTheDocument();
    expect(screen.queryByLabelText('维护组织')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /阅读全文/ })).not.toBeInTheDocument();
  });

  it('lets mobile users expand and collapse a long catalog summary', async () => {
    fixture.mobile = true;
    render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    const summary = screen.getByText(longSummary);
    const collapsedClass = summary.className;
    expect(collapsedClass).not.toBe('');
    const otherSummary = document.getElementById('engineering-tool-summary-AN001')!;
    const otherCollapsedClass = otherSummary.className;
    expect(screen.getByRole('button', { name: '自动化扩展 · 阅读全文' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: '工艺工具 · 阅读全文' }));
    expect(screen.getByRole('button', { name: '工艺工具 · 收起摘要' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '自动化扩展 · 阅读全文' })).toHaveAttribute('aria-expanded', 'false');
    expect(otherSummary.className).toBe(otherCollapsedClass);
    expect(summary).not.toHaveAttribute('class');
    await userEvent.click(screen.getByRole('button', { name: '工艺工具 · 收起摘要' }));
    expect(screen.getByRole('button', { name: '工艺工具 · 阅读全文' })).toHaveAttribute('aria-expanded', 'false');
    expect(summary.className).toBe(collapsedClass);
  });

  it('retains the complete mobile summary in the existing detail panel', () => {
    fixture.mobile = true;
    fixture.state.tabs = [{ closed: false, endpointId: null, id: 'tab-a', kind: 'detail', toolId: 'PG001' }];
    fixture.state.activeTabId = 'tab-a';
    fixture.state.panelOpen = true;
    useGlobalStore.getState().toggleRightPanel(true);
    render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getAllByText('详情与评分').length).toBeGreaterThan(0);
    expect(screen.getAllByText(longSummary).some((element) => element.tagName === 'P')).toBe(true);
  });

  it('shows closed tab history without treating it as an active tool', async () => {
    fixture.state.tabs = [
      { closed: true, endpointId: null, id: 'old-a', kind: 'detail', toolId: 'PG001' },
      { closed: true, endpointId: null, id: 'old-b', kind: 'runtime', toolId: 'PG001' },
    ];
    fixture.state.panelOpen = true;
    useGlobalStore.getState().toggleRightPanel(true);
    render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getAllByRole('button', { name: '重开 工艺工具' })).toHaveLength(2);
    expect(screen.getByText('从目录或收藏夹打开工具。')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: '重开 工艺工具' })[0]);
    expect(fixture.reopen).toHaveBeenCalledWith('old-a');
  });

  it('uses the same catalog, favorites, local_mcp entry views', async () => {
    render(<MemoryRouter initialEntries={['/engineering-tools?view=catalog']}><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    await userEvent.click(screen.getByRole('tab', { name: '我的收藏' }));
    expect(screen.getByText('视图 favorites')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '本地工具与 MCP' }));
    expect(screen.getByText('视图 local_mcp')).toBeInTheDocument();
  });

  it('does not lose an active tool when catalog filters hide it', () => {
    fixture.state.tabs = [{ closed: false, endpointId: null, id: 'tab-a', kind: 'detail', toolId: 'AN001' }];
    fixture.state.activeTabId = 'tab-a';
    fixture.state.panelOpen = true;
    useGlobalStore.getState().toggleRightPanel(true);
    render(<MemoryRouter initialEntries={['/engineering-tools']}><EngineeringToolsPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索工具' }), { target: { value: '工艺' } });
    expect(screen.getAllByText('自动化扩展').length).toBeGreaterThan(0);
    expect(screen.getByText('目录编号')).toBeInTheDocument();
  });

  it('keeps panel recovery controls available', async () => {
    render(<MemoryRouter initialEntries={['/engineering-tools']}><EngineeringToolsPage /></MemoryRouter>);
    const left = screen.getByRole('button', { name: /显示\/隐藏左侧面板|Toggle Left Panel|toggleLeftPanel/i });
    fireEvent.click(left);
    expect(useGlobalStore.getState().status.showLeftPanel).toBe(true);
    const right = screen.getByRole('button', { name: '显示工具详情' });
    await userEvent.click(right);
    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
  });

  it('blocks tool actions while workspace identity is not ready', () => {
    fixture.ready = false;
    render(<MemoryRouter initialEntries={['/engineering-tools']}><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByText('工作区加载中')).toBeInTheDocument();
    expect(screen.queryByText('工艺工具')).not.toBeInTheDocument();
  });

  it('keeps both runtime panels mounted while switching tabs', async () => {
    fixture.state.tabs = [
      { closed: false, endpointId: null, id: 'tab-a', kind: 'runtime', toolId: 'PG001' },
      { closed: false, endpointId: null, id: 'tab-b', kind: 'runtime', toolId: 'AN001' },
    ];
    fixture.state.activeTabId = 'tab-a';
    fixture.state.panelOpen = true;
    useGlobalStore.getState().toggleRightPanel(true);
    const { rerender } = render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    const runtimeA = await screen.findByTestId('runtime-PG001');
    await userEvent.click(runtimeA);
    expect(runtimeA).toHaveTextContent('本地状态 1');
    fixture.state.activeTabId = 'tab-b';
    rerender(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByTestId('runtime-AN001')).toBeInTheDocument();
    fixture.state.activeTabId = 'tab-a';
    rerender(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    expect(screen.getByTestId('runtime-PG001')).toBe(runtimeA);
    expect(runtimeA).toHaveTextContent('本地状态 1');
    expect(fixture.mounts.filter((toolId) => toolId === 'PG001')).toHaveLength(1);
    expect(fixture.mounts.filter((toolId) => toolId === 'AN001')).toHaveLength(1);
  });

  it('clears an unsaved submission across workspace scopes and ignores the old response', async () => {
    const { rerender } = render(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: '投稿与审核' }));
    await userEvent.type(screen.getByRole('textbox', { name: '投稿名称' }), 'W1 private draft');
    await userEvent.click(screen.getByRole('button', { name: '模拟迟到响应' }));
    fixture.workspaceId = 'w2';
    rerender(<MemoryRouter><EngineeringToolsPage /></MemoryRouter>);
    const draft = screen.getByRole('textbox', { name: '投稿名称' });
    expect(draft).toHaveValue('');
    fixture.resolveLate?.('W1 late response');
    expect(draft).toHaveValue('');
  });
});
