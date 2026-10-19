'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { Button, Input, Select, Spin, Tabs, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { ExternalLink, Info, PanelsTopLeft, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import NavHeader from '@/features/NavHeader';
import ContextDetailPanel, { ContextDetailToggle } from '@/features/RightPanel/ContextDetailPanel';
import { lambdaClient } from '@/libs/trpc/client';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import CommunityPanel from './CommunityPanel';
import { catalogFacetDimensions, type FacetDimension, facetDisplayLabel, type FacetSelections, filterEngineeringTools, UNKNOWN_FACET } from './facets';
import FavoriteControl from './FavoriteControl';
import LaunchPanel from './LaunchPanel';
import RatingControl from './RatingControl';
import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';
import { useToolPanelState } from './useToolPanelState';
import WorkspaceView from './WorkspaceView';

const styles = createStaticStyles(({ css, cssVar }) => ({
  advancedActions: css`
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    padding-bottom: 12px;

    @media (width < 760px) {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      > * { min-width: 0; }
    }
  `,
  controls: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
    gap: 10px;
    align-items: center;
    padding-block: 16px;

    > * { min-width: 0; }
    @media (width < 760px) {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      padding-block: 10px;
    }
  `,
  filters: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
    gap: 10px;
    padding-bottom: 14px;

    > * { min-width: 0; width: 100%; }
  `,
  header: css`
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    padding: 24px 28px 16px;
    flex-shrink: 0;

    h1 { margin: 0; font-size: 22px; overflow-wrap: anywhere; }
    @media (width < 760px) {
      padding: 12px 16px;
      h1 { font-size: 18px; }
    }
  `,
  item: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(160px, 240px);
    gap: 18px;
    align-items: center;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    padding: 16px 0;
    overflow-wrap: anywhere;
    > * { min-width: 0; }

    @media (width < 760px) { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    @container (width < 760px) { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  `,
  list: css`
    overflow: auto;
    padding: 4px 28px 40px;
    @media (width < 760px) { overflow: visible; flex: none; padding: 4px 16px 24px; }
  `,
  main: css`
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: ${cssVar.colorBgContainer};
    @media (width < 760px) { overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; }
  `,
  workspace: css`
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
  summary: css`
    @media (width < 760px) {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    }
  `,
  summaryToggle: css`
    align-self: flex-start;
    padding-inline: 0;
  `,
  tabs: css`
    display: flex;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    padding: 4px;
    scrollbar-width: thin;
    > div { display: flex; flex: 0 0 auto; align-items: center; max-width: 240px; }
    button { min-width: 0; }
    button:first-child { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
}));

const loadCatalog = async () => {
  const first = await lambdaClient.engineeringTools.listCatalog.query({ limit: 100 });
  const items = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await lambdaClient.engineeringTools.listCatalog.query({ cursor, limit: 100 });
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { items, total: first.total };
};

const sectionLabels = {
  process: '工艺与厂务',
  automation: '自动化与网络',
  design: '设计与项目',
} as const;

const views = ['catalog', 'favorites', 'local_mcp'] as const;
type View = (typeof views)[number];

const shapeLabels: Record<string, string> = {
  'cross-platform': '跨平台',
  'device-web': '设备 Web',
  hybrid: 'Web + 桌面',
  sdk: '库 / SDK',
  unknown: '环境待核',
  web: 'Web',
  windows: 'Windows 桌面',
};

const facetLabels: Record<FacetDimension, string> = {
  accessState: '接入状态', forms: '运行形态', licenseType: '许可性质', maintainerName: '维护组织',
  pricingType: '收费方式', projectPhases: '工作阶段', subsystems: '子系统',
  supportedOS: '支持系统', vendorName: '厂商',
};

const vocabularyKeys = {
  accessState: 'accessStates', forms: 'forms', licenseType: 'licenseTypes', maintainerName: 'maintainerNames',
  pricingType: 'pricingTypes', projectPhases: 'projectPhases', subsystems: 'subsystems',
  supportedOS: 'operatingSystems', vendorName: 'vendorNames',
} as const;

export const getDetailMaxWidth = (workspaceWidth: number) =>
  Math.max(320, Math.min(4096, workspaceWidth - 420));

const EngineeringToolsPage = () => {
  const [params, setParams] = useSearchParams();
  const section = params.get('section');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [filtersOpen, setFiltersOpen] = useState<boolean | null>(null);
  const { mobile } = useResponsive();
  const advancedOpen = filtersOpen ?? !mobile;
  const [selections, setSelections] = useState<FacetSelections>({});
  const [developer, setDeveloper] = useState(true);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const [visitedRuntime, setVisitedRuntime] = useState<{ scope: string | null; ids: string[] }>({ scope: null, ids: [] });
  const [communityOpen, setCommunityOpen] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(() => new Set());
  const [dragWidth, setDragWidth] = useState<number>();
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { ready: workspaceReady } = useEngineeringWorkspaceScope();
  const panel = useToolPanelState();
  const setPanelOpenRef = useRef(panel.setPanelOpen);
  const panelOpenRef = useRef(panel.state.panelOpen);
  setPanelOpenRef.current = panel.setPanelOpen;
  panelOpenRef.current = panel.state.panelOpen;
  const openDetailPanel = useGlobalStore((state) => state.toggleRightPanel);
  const detailPanelExpanded = useGlobalStore(systemStatusSelectors.showRightPanel);
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const scopeKey = workspaceReady && userId ? `${userId}:${workspaceId ?? 'global'}` : null;
  const hydratedScope = useRef<string | null>(null);
  const syncingPanel = useRef(false);
  useEffect(() => {
    if (!scopeKey || !panel.ready || hydratedScope.current === scopeKey) return;
    hydratedScope.current = scopeKey;
    if (detailPanelExpanded !== panel.state.panelOpen) {
      syncingPanel.current = true;
      openDetailPanel(panel.state.panelOpen);
    }
  }, [scopeKey, panel.ready, detailPanelExpanded, panel.state.panelOpen, openDetailPanel]);
  useEffect(() => {
    if (syncingPanel.current) { syncingPanel.current = false; return; }
    if (scopeKey && hydratedScope.current === scopeKey && panel.ready && typeof detailPanelExpanded === 'boolean' && detailPanelExpanded !== panelOpenRef.current)
      setPanelOpenRef.current(detailPanelExpanded);
  }, [scopeKey, panel.ready, detailPanelExpanded]);
  useEffect(() => { setDragWidth(undefined); }, [scopeKey]);
  const { data, error, isLoading, mutate } = useSWR(
    userId && workspaceReady ? ['engineering-tools-catalog', userId, workspaceId ?? 'global'] : null,
    loadCatalog,
    { revalidateOnFocus: true },
  );
  const { data: vocabulary } = useSWR('engineering-tools-vocabulary', () => lambdaClient.engineeringTools.vocabulary.query());
  const { data: menu } = useSWR('engineering-tools-menu', () => lambdaClient.engineeringTools.menu.query());
  const catalog = useMemo(() => data?.items ?? [], [data]);

  const viewParam = params.get('view');
  const view: View = views.find((item) => item === viewParam) ?? 'catalog';
  const setView = (nextView: View) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set('view', nextView);
    return next;
  });
  const selectedSection = section && Object.hasOwn(sectionLabels, section) ? section : 'process';
  const sectionLabel = menu?.find((item) => item.path.endsWith(`section=${selectedSection}`))?.label ??
    sectionLabels[selectedSection as keyof typeof sectionLabels];
  useEffect(() => { setSelections({}); }, [selectedSection]);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const update = () => setWorkspaceWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const visible = useMemo(() => filterEngineeringTools(catalog, {
    developer, scope, search, section: selectedSection, selections, vocabulary,
  }), [catalog, developer, scope, search, selectedSection, selections, vocabulary]);
  const activeTab = panel.state.tabs.find((tab) => tab.id === panel.state.activeTabId && !tab.closed);
  const detailTool = catalog.find((tool) => tool.id === activeTab?.toolId);
  const activeTabId = activeTab?.id;
  const activeTabKind = activeTab?.kind;
  useEffect(() => {
    if (!scopeKey || !activeTabId || activeTabKind !== 'runtime') return;
    setVisitedRuntime((current) => {
      const ids = current.scope === scopeKey ? current.ids : [];
      return ids.includes(activeTabId) ? current : { scope: scopeKey, ids: [...ids, activeTabId] };
    });
  }, [activeTabId, activeTabKind, scopeKey]);
  const scopeCount = catalog.filter((tool) => scope === 'all' || tool.section === selectedSection).length;
  const detailMaxWidth = getDetailMaxWidth(workspaceWidth);
  const openTool = (toolId: string, endpointId: string | null = null, kind: 'detail' | 'runtime' = 'detail') => {
    if (!panel.ready) return;
    panel.open(toolId, kind, endpointId);
    openDetailPanel(true);
  };
  const optionsFor = (dimension: FacetDimension) => {
    const key = vocabularyKeys[dimension];
    const stored = vocabulary?.[key] ?? [];
    const observed = catalog.flatMap((tool) => {
      const value = tool[dimension];
      return Array.isArray(value) ? value : value ? [value] : [];
    });
    const inactive = vocabulary?.inactive?.[dimension] ?? [];
    return [
      { label: '未知', value: UNKNOWN_FACET },
      ...[...new Set([...stored, ...observed].filter((value) => value !== 'unknown'))]
        .filter((value) => !inactive.includes(value))
        .sort((a, b) => a.localeCompare(b)).map((value) => ({
          label: facetDisplayLabel(dimension, value, vocabulary), value,
        })),
    ];
  };
  const scopeControl = <div><label className={styles.muted} htmlFor="engineering-tool-scope">分类范围</label><Select id="engineering-tool-scope" options={[{ label: '全部分类', value: 'all' }, { label: `当前分类：${sectionLabel}`, value: 'current' }]} value={scope} onChange={(value) => setScope(value as 'all' | 'current')} /></div>;
  const activeAdvancedCount = (scope === 'current' ? 1 : 0) + (developer ? 0 : 1) + Object.values(selections).filter((values) => values?.length).length;

  return (
    <div data-engineering-tools-page className={styles.workspace} ref={workspaceRef}>
    <div className={styles.main} style={{ flex: 1, minWidth: 0 }}>
      <NavHeader right={<ContextDetailToggle title="工具详情" />} />
      <div style={{ minWidth: 0, overflowX: 'auto', flexShrink: 0 }}><Tabs activeKey={view} items={[
        { key: 'catalog', label: '工具目录' }, { key: 'favorites', label: '我的收藏' },
        { key: 'local_mcp', label: '本地工具与 MCP' },
      ]} onChange={(key) => setView(key as View)} /></div>
      {view === 'catalog' && communityOpen ? <><div style={{ padding: '12px 28px 0' }}><Button onClick={() => setCommunityOpen(false)}>返回工具目录</Button></div>{scopeKey ? <CommunityPanel key={scopeKey} onCatalogChange={() => void mutate()} /> : <Empty description="工作区加载中" />}</> : view === 'catalog' ? <>
      <header className={styles.header}>
        <h1>{scope === 'all' ? '全部工程工具' : sectionLabel}</h1>
        <div className={styles.controls}>
          {!mobile && scopeControl}
          <Input
            allowClear
            aria-label="搜索工具"
            placeholder="搜索工具、专业或用途"
            prefix={<Search size={15} />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button aria-expanded={advancedOpen} onClick={() => setFiltersOpen(!advancedOpen)}>{advancedOpen ? '收起筛选' : `展开筛选${activeAdvancedCount ? `（${activeAdvancedCount}）` : ''}`}</Button>
          {!mobile && <Button onClick={() => setCommunityOpen(true)}>投稿与审核</Button>}
        </div>
        {advancedOpen && <><div className={styles.advancedActions}>
          {mobile && scopeControl}
          <label><input checked={developer} type="checkbox" onChange={(event) => setDeveloper(event.target.checked)} /> 开发与扩展</label>
          <Button onClick={() => { setSearch(''); setSelections({}); setDeveloper(true); }}>清除筛选</Button>
          {mobile && <Button onClick={() => setCommunityOpen(true)}>投稿与审核</Button>}
        </div><div className={styles.filters}>{catalogFacetDimensions.map((dimension) => <div key={dimension}>
          <label className={styles.muted} htmlFor={`engineering-tool-${dimension}`}>{facetLabels[dimension]}</label><Select
            showSearch
            id={`engineering-tool-${dimension}`}
            key={dimension}
            mode="multiple"
            options={optionsFor(dimension)}
            placeholder={facetLabels[dimension]}
            style={{ width: '100%' }}
            value={selections[dimension] ?? []}
            onChange={(values) => setSelections((previous) => ({
              ...previous, [dimension]: Array.isArray(values) ? values : values ? [values] : [],
            }))}
          /></div>)}</div></>}
        <div className={styles.muted}>{visible.length} / {scopeCount} 项（{scope === 'all' ? '全部工具' : sectionLabel}；目录总数 {data?.total ?? 0}）· 目录链接不代表已安装、已授权或已实机验证</div>
      </header>
      <div className={styles.list}>
        {!workspaceReady ? <Empty description="工作区加载中" /> : isLoading ? <Spin /> : error ? <button type="button" onClick={() => mutate()}>目录加载失败，重试</button> : visible.length === 0 ? <Empty description="没有匹配的工具" /> : visible.map((tool) => {
          const url = tool.productUrl ?? tool.sourceUrl;
          const action = tool.shape === 'windows' ? '查看 Windows 安装与授权说明' : '查看产品资料';
          const summaryExpanded = expandedSummaries.has(tool.id);
          return (
          <div className={styles.item} key={tool.id}>
              <Flexbox gap={5}>
                <strong>{tool.name}</strong>
                <span className={styles.muted}>{tool.id} · {tool.category}</span>
                <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
                  <Tag>{shapeLabels[tool.shape]}</Tag>
                  <Tag>{tool.enabled ? tool.availability : `历史归档 · ${tool.publicReason ?? '原由待核'}`}</Tag>
                </Flexbox>
              </Flexbox>
              <Flexbox gap={5}>
                <span className={summaryExpanded ? undefined : styles.summary} id={`engineering-tool-summary-${tool.id}`}>{tool.summary}</span>
                {mobile && tool.summary && <Button
                  aria-controls={`engineering-tool-summary-${tool.id}`}
                  aria-expanded={summaryExpanded}
                  aria-label={`${tool.name} · ${summaryExpanded ? '收起摘要' : '阅读全文'}`}
                  className={styles.summaryToggle}
                  size="small"
                  type="text"
                  onClick={() => setExpandedSummaries((current) => {
                    const next = new Set(current);
                    if (next.has(tool.id)) next.delete(tool.id);
                    else next.add(tool.id);
                    return next;
                  })}
                >{summaryExpanded ? '收起摘要' : '阅读全文'}</Button>}
                <span className={styles.muted}>{[
                  vocabulary?.labels?.vendorName?.[tool.vendorName ?? ''] ?? tool.vendorName,
                  vocabulary?.labels?.maintainerName?.[tool.maintainerName ?? ''] ?? tool.maintainerName,
                  tool.licenseType && facetDisplayLabel('licenseType', tool.licenseType, vocabulary),
                  tool.pricingType && facetDisplayLabel('pricingType', tool.pricingType, vocabulary), tool.license,
                ].filter(Boolean).join(' · ')}</span>
              </Flexbox>
              <Flexbox gap={4}>
                <FavoriteControl toolId={tool.id} toolName={tool.name} />
                <Button disabled={!isStatusInit || !panel.ready} icon={<Info aria-hidden size={14} />} onClick={() => openTool(tool.id)}>
                  详情与评分
                </Button>
                {tool.enabled ? <Button disabled={!panel.ready} icon={<PanelsTopLeft size={14} />} onClick={() => openTool(tool.id, null, 'runtime')}>选择启动入口</Button> : <Button disabled>归档不可启动</Button>}
                {url && <a href={url} rel="noopener noreferrer" target="_blank">{action} <ExternalLink aria-hidden size={14} /></a>}
                {tool.officialWebsiteUrl && tool.officialWebsiteUrl !== url && <a href={tool.officialWebsiteUrl} rel="noopener noreferrer" target="_blank">企业官网</a>}
                {tool.purchaseUrl && <a href={tool.purchaseUrl} rel="noopener noreferrer" target="_blank">购买渠道</a>}
              </Flexbox>
            </div>
          );
        })}
      </div>
      </> : <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>{scopeKey && <WorkspaceView key={scopeKey} tools={catalog} view={view} onLaunch={(toolId, endpointId) => openTool(toolId, endpointId, 'runtime')} />}</AsyncBoundary>}
    </div>
    <ContextDetailPanel defaultWidth={Math.min(560, detailMaxWidth)} fullWidth={fullWidth} maxWidth={detailMaxWidth} minWidth={320} title="工具详情" width={Math.min(dragWidth ?? panel.state.width ?? 560, detailMaxWidth)} onFullWidthChange={setFullWidth} onSizeChange={(size) => { if (typeof size?.width === 'number') { setDragWidth(size.width); panel.setWidth(size.width); } }}>
      <div aria-label="已打开工具" className={styles.tabs} role="tablist">
        {panel.state.tabs.filter((tab) => !tab.closed).map((tab) => {
          const tool = catalog.find((item) => item.id === tab.toolId);
          return <div key={tab.id}>
            <Button aria-selected={tab.id === panel.state.activeTabId} role="tab" title={tool?.name ?? tab.toolId} onClick={() => panel.select(tab.id)}>{tool?.name ?? tab.toolId}{tab.kind === 'runtime' ? ' · 运行' : ''}</Button>
            <Button aria-label={`关闭 ${tool?.name ?? tab.toolId}`} icon={<X size={14} />} title="关闭标签" onClick={() => panel.close(tab.id)} />
          </div>;
        })}
      </div>
      {panel.state.tabs.some((tab) => tab.closed) && <div style={{ minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {panel.state.tabs.filter((tab) => tab.closed).map((tab) => <Button key={tab.id} onClick={() => panel.reopen(tab.id)}>重开 {catalog.find((tool) => tool.id === tab.toolId)?.name ?? tab.toolId}</Button>)}
      </div>}
      {panel.failure && <p role="alert">{panel.failure}</p>}
      {detailTool && activeTab ? <>
      <h2>{detailTool.name}</h2>
      <p>{detailTool.summary}</p>
      {detailTool.description && <p>{detailTool.description}</p>}
      <dl>
        <dt>目录编号</dt><dd>{detailTool.id}</dd>
        <dt>分类</dt><dd>{detailTool.category}</dd>
        <dt>运行形态</dt><dd>{shapeLabels[detailTool.shape]}</dd>
        <dt>安装与授权</dt><dd>{detailTool.availability} · {detailTool.license}</dd>
        {detailTool.vendorName && <><dt>厂商</dt><dd>{detailTool.vendorName}</dd></>}
      </dl>
      {scopeKey && <RatingControl key={`${scopeKey}:${detailTool.id}`} toolId={detailTool.id} />}
      {detailTool.enabled ? <>
        <div style={{ display: 'flex', gap: 8, paddingBlock: 8 }}>
          <Button aria-pressed={activeTab.kind === 'detail'} onClick={() => panel.setKind(activeTab.id, 'detail')}>详情</Button>
          <Button aria-pressed={activeTab.kind === 'runtime'} onClick={() => panel.setKind(activeTab.id, 'runtime')}>运行</Button>
        </div>
        {activeTab.kind === 'runtime' && <Button aria-label="刷新当前工具" icon={<RefreshCw size={14} />} title="刷新当前工具" onClick={() => {
          setRefreshKeys((keys) => ({ ...keys, [activeTab.id]: (keys[activeTab.id] ?? 0) + 1 }));
          void mutate();
        }}>刷新入口</Button>}
      </> : <p role="status">历史归档，不能启动。{detailTool.publicReason ?? '原由待核'}</p>}
      {(detailTool.productUrl ?? detailTool.sourceUrl) && <a href={detailTool.productUrl ?? detailTool.sourceUrl} rel="noopener noreferrer" target="_blank">查看产品资料 <ExternalLink aria-hidden size={14} /></a>}
      </> : <>
        <h2>{activeTab ? '工具不可用' : '已打开工具'}</h2>
        <p>{activeTab ? '该工具记录已撤销或当前无权查看，不能启动。' : '从目录或收藏夹打开工具。'}</p>
      </>}
      {panel.state.tabs.filter((tab) => !tab.closed && visitedRuntime.scope === scopeKey && visitedRuntime.ids.includes(tab.id)).map((tab) => {
        const tool = catalog.find((item) => item.id === tab.toolId);
        if (!tool?.enabled) return null;
        const active = activeTab?.id === tab.id && tab.kind === 'runtime';
        return <div hidden={!active} inert={!active} key={`${scopeKey}:${tab.id}:${refreshKeys[tab.id] ?? 0}`}>
          <LaunchPanel active={active} defaultEndpointId={tab.endpointId} toolId={tool.id} toolName={tool.name}
            onEndpointChange={(endpointId) => panel.setEndpoint(tab.id, endpointId)} />
          <p className={styles.muted}>刷新后可恢复标签与入口选择；第三方页面内的未保存内容和登录状态不在此恢复。</p>
        </div>;
      })}
    </ContextDetailPanel>
    </div>
  );
};

export default EngineeringToolsPage;
