'use client';

import { Input } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CustomConnectorModal from '@/features/Connectors/CustomConnectorModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import { fabSkillItems, localMcpItems, localModelItems, localProviderItems } from './catalog';
import MarketSourceTabs, { type MarketSource } from './MarketSourceTabs';
import { loadLocalMcpConnectorPreset, type LocalMcpConnectorPreset } from './mcpPreset';
import { styles } from './style';
import { type LocalMarketItem, type LocalMarketKind } from './types';

const titles: Record<LocalMarketKind, string> = {
  mcp: '本地 MCP 市场',
  models: '本地模型市场',
  providers: '本地模型供应商市场',
  skills: '本地技能市场',
};

const localItems: Record<LocalMarketKind, LocalMarketItem[]> = {
  mcp: localMcpItems,
  models: localModelItems,
  providers: localProviderItems,
  skills: fabSkillItems,
};

const LocalMarketCatalog = ({ kind }: { kind: LocalMarketKind }) => {
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');
  const [source, setSource] = useState<MarketSource>('fab');
  const [mirrorItems, setMirrorItems] = useState<LocalMarketItem[]>([]);
  const [mirrorTotal, setMirrorTotal] = useState(0);
  const [mirrorPage, setMirrorPage] = useState(1);
  const [mirrorAll, setMirrorAll] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string>();
  const [connectorPreset, setConnectorPreset] = useState<LocalMcpConnectorPreset>();
  const installedSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills);
  const connectors = useToolStore((state) => state.connectors);
  const refreshAgentSkills = useToolStore((state) => state.refreshAgentSkills);
  const fetchConnectors = useToolStore((state) => state.fetchConnectors);

  useEffect(() => {
    if (kind === 'mcp') void fetchConnectors();
  }, [fetchConnectors, kind]);

  useEffect(() => {
    if (source !== 'local' || (kind !== 'skills' && kind !== 'mcp')) return;

    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({
      all: mirrorAll || query.trim() ? '1' : '0',
      limit: '80',
      page: String(mirrorPage),
    });
    if (mirrorAll && kind === 'skills') params.set('view', 'reference');
    if (query.trim()) params.set('q', query.trim());
    void fetch(`/market/local/${kind}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`local market ${response.status}`);
        return response.json() as Promise<{ items: LocalMarketItem[]; total?: number }>;
      })
      .then(({ items, total }) => {
        setMirrorItems(items);
        setMirrorTotal(total || 0);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') setError(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [kind, mirrorAll, mirrorPage, query, source]);

  const items = useMemo(
    () => (source === 'fab' ? localItems[kind] : mirrorItems),
    [kind, mirrorItems, source],
  );

  const installSkill = async (item: LocalMarketItem) => {
    if (!item.installable || !item.sourceId || pending) return;
    const sourceId = item.sourceId;
    if (item.status === 'needs-config') {
      const permissions = item.permissions?.length ? item.permissions.join('、') : '无额外权限声明';
      const confirmed = await confirmModal({
        content: `该技能需要确认权限或依赖：${permissions}。安装只创建当前用户副本，不会修改市场。`,
        okText: '确认安装当前用户副本',
        title: `安装“${item.name}”`,
      });
      if (!confirmed) return;
    }
    setPending(item.id);
    setError(false);
    setActionError('');
    try {
      await agentSkillService.importFromLocalMarket(sourceId, {
        permissions: item.permissions,
        warnings: item.missing,
      });
      await refreshAgentSkills();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '本地技能安装失败');
    } finally {
      setPending(undefined);
    }
  };

  const configureMcp = async (item: LocalMarketItem) => {
    if (!item.sourceId || pending || item.transport === 'stdio') return;
    setPending(item.id);
    setError(false);
    setActionError('');
    try {
      setConnectorPreset(await loadLocalMcpConnectorPreset(item));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'MCP 配置加载失败');
    } finally {
      setPending(undefined);
    }
  };

  return (
    <main className={styles.page} data-testid={`local-market-${kind}`}>
      <div className={styles.header}>
        <div>
          <Button icon={ArrowLeft} size="small" type="text" onClick={() => navigate('/community')}>
            返回本地市场
          </Button>
          <h1>{titles[kind]}</h1>
          <div className={styles.meta}>
            Fab 本地能力、每日同步的精选清单和当前运行时目录分开展示。
          </div>
        </div>
        {(kind === 'skills' || kind === 'mcp') && (
          <span className={styles.meta}>{loading ? '正在读取本地精选清单…' : '每日同步清单'}</span>
        )}
      </div>

      {(kind === 'skills' || kind === 'mcp') && (
        <MarketSourceTabs
          source={source}
          onChange={(nextSource) => {
            setSource(nextSource);
            setMirrorPage(1);
          }}
        />
      )}

      {error && <p role="status">本地镜像暂时不可用，仍显示 FAB 专用能力。</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {source === 'local' && (
        <div className={styles.marketNotice}>
          <span className={styles.meta} role="status">
            {loading
              ? '正在读取既有本地镜像…'
              : mirrorAll
                ? kind === 'skills'
                  ? `待补全资料 ${mirrorTotal.toLocaleString()} 条；这些条目没有本地完整包，不提供安装。`
                  : `全部本地 MCP ${mirrorTotal.toLocaleString()} 条；按部署定义显示可配置、需 runner 或缺清单状态。`
                : `可安装或需配置 ${mirrorTotal.toLocaleString()} 条；浏览器只加载当前页。`}
          </span>
          <Button
            size="small"
            type="text"
            onClick={() => {
              setMirrorAll((value) => !value);
              setMirrorPage(1);
            }}
          >
            {mirrorAll ? '返回精选市场' : kind === 'skills' ? '资料目录 / 待补全' : '全部本地 MCP'}
          </Button>
        </div>
      )}
      {source === 'local' && (
        <Input
          aria-label={`搜索${titles[kind]}`}
          placeholder={`搜索${titles[kind]}`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setMirrorPage(1);
          }}
        />
      )}
      <div className={styles.cardGrid}>
        {items.map((item) => (
          <article className={styles.card} key={`${item.source}:${item.id}`}>
            <span className={styles.tag}>
              {item.source === 'fab'
                ? 'FAB 专用'
                : item.source === 'quality' || item.source === 'local-mirror'
                  ? '本地镜像'
                  : '运行时'}
            </span>
            <h2 className={styles.title}>{item.name}</h2>
            <p className={styles.description}>{item.description}</p>
            <div className={styles.meta}>
              {[
                item.official && '官方',
                item.featured && '精选',
                item.author,
                item.stars !== undefined ? `★ ${item.stars.toLocaleString()}` : '星级暂无数据',
                item.installCount !== undefined
                  ? `使用 ${item.installCount.toLocaleString()}`
                  : '使用量暂无数据',
                item.ratingCount !== undefined
                  ? `评价 ${item.ratingCount.toLocaleString()}`
                  : '评价暂无数据',
                item.score !== undefined ? `评分 ${item.score.toFixed(2)}` : '评分暂无数据',
                item.updatedAt && `更新 ${item.updatedAt}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className={styles.meta}>
              {item.status === 'installable'
                ? '可安装'
                : item.status === 'needs-config'
                  ? '需配置'
                  : item.status === 'blocked'
                    ? '已阻断'
                    : '仅元数据'}
              {item.missing?.length ? `：${item.missing.join('；')}` : ''}
            </div>
            {item.source === 'local-mirror' && kind === 'skills' && !mirrorAll ? (
              item.installable ? (
                <Button
                  loading={pending === item.id}
                  size="small"
                  type="primary"
                  disabled={installedSkills.some(
                    (skill) => skill.identifier === `local.market.${item.sourceId}`,
                  )}
                  onClick={() => void installSkill(item)}
                >
                  {installedSkills.some(
                    (skill) => skill.identifier === `local.market.${item.sourceId}`,
                  )
                    ? '已安装当前用户副本'
                    : item.status === 'needs-config'
                      ? '确认权限并安装'
                      : '安装到当前用户'}
                </Button>
              ) : (
                <Button disabled size="small">
                  安全门禁未通过
                </Button>
              )
            ) : item.source === 'local-mirror' && kind === 'mcp' && !mirrorAll ? (
              item.installable ? (
                <Button
                  loading={pending === item.id}
                  size="small"
                  disabled={
                    item.transport === 'stdio' ||
                    connectors.some((connector) => connector.identifier === item.sourceId)
                  }
                  onClick={() => void configureMcp(item)}
                >
                  {connectors.some((connector) => connector.identifier === item.sourceId)
                    ? '已添加到我的连接器'
                    : item.transport === 'stdio'
                      ? '需要 OnlyBoxes runner'
                      : '在 Fab 内配置并验证'}
                </Button>
              ) : (
                <Button disabled size="small">
                  缺少部署清单
                </Button>
              )
            ) : item.source === 'local-mirror' ? (
              item.homepage ? (
                <a href={item.homepage} rel="noopener noreferrer" target="_blank">
                  <Button icon={ExternalLink} size="small" type="text">
                    查看来源
                  </Button>
                </a>
              ) : (
                <Button disabled size="small">
                  {item.status === 'blocked' ? '已阻断，不可安装' : '仅元数据，暂不可安装'}
                </Button>
              )
            ) : item.source === 'fab' && kind === 'skills' ? (
              <Button size="small" onClick={() => navigate('/settings/skill')}>
                进入技能授权
              </Button>
            ) : item.source === 'fab' && kind === 'mcp' ? (
              <Button size="small" onClick={() => navigate('/settings/connector')}>
                进入 MCP 授权
              </Button>
            ) : item.homepage ? (
              <a href={item.homepage} rel="noreferrer" target="_blank">
                <Button icon={ExternalLink} size="small" type="text">
                  查看来源
                </Button>
              </a>
            ) : (
              <Button disabled={!item.installable} size="small">
                {item.installable ? '已内置，可在助手档案启用' : '仅精选目录，离线包待核验'}
              </Button>
            )}
          </article>
        ))}
      </div>
      {source === 'local' && mirrorTotal > 80 && (
        <div className={styles.pagination}>
          <Button
            disabled={mirrorPage <= 1}
            size="small"
            onClick={() => setMirrorPage((page) => Math.max(1, page - 1))}
          >
            上一页
          </Button>
          <span className={styles.meta}>
            第 {mirrorPage} 页 / 共 {Math.ceil(mirrorTotal / 80)} 页
          </span>
          <Button
            disabled={mirrorPage >= Math.ceil(mirrorTotal / 80)}
            size="small"
            onClick={() => setMirrorPage((page) => page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      <p className={styles.meta}>
        {source === 'local'
          ? '来源：既有 market-mirror / quality 快照。此页不触发官方登录或官方市场同步。'
          : t('localMarket.qualityNotice', {
              defaultValue: 'FAB 专用能力按当前站点离线配置展示，安装与授权边界以卡片状态为准。',
            })}
      </p>
      <CustomConnectorModal
        initialMetadata={connectorPreset?.metadata}
        initialValue={connectorPreset?.value}
        open={Boolean(connectorPreset)}
        onClose={() => setConnectorPreset(undefined)}
        onEditSuccess={() => {
          void fetchConnectors();
          setConnectorPreset(undefined);
        }}
      />
    </main>
  );
};

export default LocalMarketCatalog;
