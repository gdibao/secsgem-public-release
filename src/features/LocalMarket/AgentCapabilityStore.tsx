'use client';

import { getPluginMode, upsertPluginMode } from '@lobechat/types';
import { Input } from '@lobehub/ui';
import { Avatar, Button, confirmModal } from '@lobehub/ui/base-ui';
import { useEffect, useMemo, useState } from 'react';

import CustomConnectorModal from '@/features/Connectors/CustomConnectorModal';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { getAgentStoreState, useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import { FAB_SANDBOX_TOOL_ID, fabSkillItems, localMcpItems } from './catalog';
import { loadLocalMcpConnectorPreset, type LocalMcpConnectorPreset } from './mcpPreset';
import { styles } from './style';
import { type LocalMarketItem } from './types';

type CapabilityView = 'fab-mcp' | 'fab-skills' | 'local-mcp' | 'local-skills';

const viewLabels: Record<CapabilityView, string> = {
  'fab-mcp': 'FAB MCP',
  'fab-skills': 'FAB 专用技能',
  'local-mcp': '本地 MCP',
  'local-skills': '本地镜像技能',
};

const AgentCapabilityStore = ({ agentId }: { agentId?: string }) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const activeAgentId = useAgentStore((state) => state.activeAgentId);
  const targetAgentId = agentId || activeAgentId || '';
  const { isLoading: configLoading } = useInitAgentConfig(targetAgentId);
  const config = useAgentStore(agentSelectors.getAgentConfigById(targetAgentId));
  const updateAgentConfigById = useAgentStore((state) => state.updateAgentConfigById);
  const [view, setView] = useState<CapabilityView>('fab-skills');
  const [query, setQuery] = useState('');
  const [mirrorItems, setMirrorItems] = useState<LocalMarketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string>();
  const [connectorPreset, setConnectorPreset] = useState<LocalMcpConnectorPreset>();
  const installedSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills);
  const refreshAgentSkills = useToolStore((state) => state.refreshAgentSkills);
  const agentConnectors = useToolStore((state) => state.agentConnectors[targetAgentId] || []);
  const fetchAgentConnectors = useToolStore((state) => state.fetchAgentConnectors);
  const detachConnectorFromAgent = useToolStore((state) => state.detachConnectorFromAgent);
  const provisionFabLocalMcp = useToolStore((state) => state.provisionFabLocalMcp);
  const provisionFabOfflineKnowledge = useToolStore((state) => state.provisionFabOfflineKnowledge);

  useEffect(() => {
    if (targetAgentId) void fetchAgentConnectors(targetAgentId);
  }, [fetchAgentConnectors, targetAgentId]);

  useEffect(() => {
    if (view === 'fab-skills' || view === 'fab-mcp') return;

    const controller = new AbortController();
    const kind = view === 'local-skills' ? 'skills' : 'mcp';
    const params = new URLSearchParams({
      all: query.trim() ? '1' : '0',
      limit: '24',
      page: '1',
    });
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    setError(false);
    void fetch(`/market/local/${kind}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`local capability market ${response.status}`);
        return response.json() as Promise<{ items: LocalMarketItem[] }>;
      })
      .then(({ items }) => setMirrorItems(items))
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') setError(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [query, view]);

  const items = useMemo(() => {
    if (view === 'local-skills' || view === 'local-mcp') return mirrorItems;
    if (view === 'fab-mcp') return localMcpItems;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return fabSkillItems;
    return fabSkillItems.filter((item) =>
      [item.id, item.name, item.description, item.category]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [mirrorItems, query, view]);

  const persistSkillBinding = async (identifier: string, bound: boolean) => {
    const latestConfig = agentSelectors.getAgentConfigById(targetAgentId)(getAgentStoreState());
    await updateAgentConfigById(
      targetAgentId,
      { plugins: upsertPluginMode(latestConfig?.plugins, identifier, bound ? 'pinned' : 'auto') },
      { rethrow: true },
    );
    const savedConfig = agentSelectors.getAgentConfigById(targetAgentId)(getAgentStoreState());
    const saved = getPluginMode(savedConfig?.plugins, identifier) === 'pinned';
    if (saved !== bound) throw new Error('Skill binding was not persisted');
  };

  const setSkillBinding = async (item: LocalMarketItem, bound: boolean) => {
    if (!targetAgentId || !canEdit || pending) return;
    if (!bound) {
      const confirmed = await confirmModal({
        content: `只解除“${item.name}”与当前助手的绑定，不会删除市场条目，也不影响其他用户或助手。`,
        okText: '解除当前助手绑定',
        title: '确认解除技能绑定',
      });
      if (!confirmed) return;
    }

    setPending(item.id);
    setError(false);
    setActionError('');
    try {
      await persistSkillBinding(item.id, bound);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '技能绑定失败');
    } finally {
      setPending(undefined);
    }
  };

  const configureRemoteMcp = async (item: LocalMarketItem) => {
    if (!item.sourceId) return;
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

  const renderAction = (item: LocalMarketItem) => {
    if (view === 'fab-skills') {
      const bound = getPluginMode(config?.plugins, item.id) === 'pinned';
      return (
        <Button
          disabled={!targetAgentId || !canEdit || configLoading || Boolean(pending)}
          loading={pending === item.id}
          size="small"
          type={bound ? 'default' : 'primary'}
          onClick={() => void setSkillBinding(item, !bound)}
        >
          {bound ? '解除当前助手绑定' : '安装并绑定到当前助手'}
        </Button>
      );
    }

    if (view === 'local-skills' && item.installable && item.sourceId) {
      const sourceId = item.sourceId;
      const identifier = `local.market.${sourceId}`;
      const installed = installedSkills.find((skill) => skill.identifier === identifier);
      const bound = getPluginMode(config?.plugins, identifier) === 'pinned';
      return (
        <Button
          disabled={!targetAgentId || !canEdit || configLoading || Boolean(pending)}
          loading={pending === item.id}
          size="small"
          type={bound ? 'default' : 'primary'}
          onClick={async () => {
            if (bound) {
              await setSkillBinding({ ...item, id: identifier }, false);
              return;
            }
            if (item.status === 'needs-config') {
              const permissions = item.permissions?.length
                ? item.permissions.join('、')
                : '无额外权限声明';
              const confirmed = await confirmModal({
                content: `该技能需要确认权限或依赖：${permissions}。将安装当前用户副本并只绑定当前助手。`,
                okText: '安装并绑定',
                title: `安装“${item.name}”`,
              });
              if (!confirmed) return;
            }
            setPending(item.id);
            setActionError('');
            try {
              const result =
                installed ||
                (
                  await agentSkillService.importFromLocalMarket(sourceId, {
                    permissions: item.permissions,
                    warnings: item.missing,
                  })
                )?.skill;
              if (!result) throw new Error('Local skill installation returned no skill');
              await refreshAgentSkills();
              await persistSkillBinding(result.identifier, true);
            } catch (reason) {
              setActionError(reason instanceof Error ? reason.message : '本地技能安装失败');
            } finally {
              setPending(undefined);
            }
          }}
        >
          {bound ? '解除当前助手绑定' : installed ? '绑定到当前助手' : '安装并绑定到当前助手'}
        </Button>
      );
    }

    if (view === 'fab-mcp' && item.id === 'fab-local-sandbox') {
      const bound = getPluginMode(config?.plugins, FAB_SANDBOX_TOOL_ID) === 'pinned';
      return (
        <Button
          disabled={!targetAgentId || !canEdit || configLoading || Boolean(pending)}
          loading={pending === item.id}
          size="small"
          type={bound ? 'default' : 'primary'}
          onClick={async () => {
            if (bound) {
              const confirmed = await confirmModal({
                content: '只解除原生 OnlyBoxes 沙箱与当前助手的绑定，不影响其他用户或助手。',
                okText: '解除当前助手沙箱',
                title: '确认解除沙箱',
              });
              if (!confirmed) return;
            }
            setPending(item.id);
            setActionError('');
            try {
              await persistSkillBinding(FAB_SANDBOX_TOOL_ID, !bound);
            } catch (reason) {
              setActionError(reason instanceof Error ? reason.message : '沙箱绑定失败');
            } finally {
              setPending(undefined);
            }
          }}
        >
          {bound ? '解除当前助手沙箱' : '启用原生沙箱到当前助手'}
        </Button>
      );
    }

    if ((view === 'fab-mcp' || view === 'local-mcp') && item.installable && item.sourceId) {
      const sourceId = item.sourceId;
      const connectorIdentifier = item.id === 'fab-offline-knowledge' ? item.id : sourceId;
      const connector = agentConnectors.find((entry) => entry.identifier === connectorIdentifier);
      return (
        <Button
          disabled={!targetAgentId || !canEdit || configLoading || Boolean(pending)}
          loading={pending === item.id}
          size="small"
          type={connector?.status === 'connected' ? 'default' : 'primary'}
          onClick={async () => {
            if (connector?.status === 'connected') {
              const confirmed = await confirmModal({
                content: `只解除“${item.name}”与当前助手的连接，不会删除市场条目，也不影响其他用户或助手。`,
                okText: '解除当前助手连接',
                title: '确认解除 MCP',
              });
              if (!confirmed) return;
              setPending(item.id);
              setActionError('');
              try {
                await detachConnectorFromAgent(connector.id, targetAgentId, 'delete');
              } catch (reason) {
                setActionError(reason instanceof Error ? reason.message : '解除 MCP 失败');
              } finally {
                setPending(undefined);
              }
              return;
            }
            if (view === 'local-mcp' && item.transport === 'stdio') return;
            if (view === 'local-mcp' && item.status === 'needs-config') {
              await configureRemoteMcp(item);
              return;
            }
            const confirmed = await confirmModal({
              content: `将在当前助手中配置“${item.name}”，凭据由 Fab 服务端保管，并立即执行 tools/list 健康验证。`,
              okText: '配置并验证',
              title: '配置本地 MCP',
            });
            if (!confirmed) return;
            setPending(item.id);
            setError(false);
            setActionError('');
            try {
              if (item.id === 'fab-offline-knowledge') {
                await provisionFabOfflineKnowledge(targetAgentId);
              } else {
                await provisionFabLocalMcp(sourceId, targetAgentId);
              }
            } catch (reason) {
              setActionError(reason instanceof Error ? reason.message : 'MCP 挂载或验证失败');
            } finally {
              setPending(undefined);
            }
          }}
        >
          {connector?.status === 'connected'
            ? `解除当前助手连接 · ${connector.tools?.length || 0} 个工具`
            : view === 'local-mcp' && item.transport === 'stdio'
              ? '需要 OnlyBoxes runner'
              : '配置到当前助手并验证'}
        </Button>
      );
    }

    return (
      <Button disabled size="small">
        {item.status === 'blocked' ? '已阻断' : '仅元数据，缺少可安装内容'}
      </Button>
    );
  };

  const visibleItems = items;

  return (
    <section className={styles.capabilityStore} data-testid="fab-agent-capability-store">
      <div aria-label="能力来源" className={styles.sourceTabs} role="tablist">
        {(Object.keys(viewLabels) as CapabilityView[]).map((key) => (
          <button
            aria-selected={view === key}
            className={view === key ? styles.sourceTabActive : styles.sourceTab}
            key={key}
            role="tab"
            type="button"
            onClick={() => setView(key)}
          >
            {viewLabels[key]}
          </button>
        ))}
      </div>
      <Input
        aria-label="搜索本地技能或 MCP"
        placeholder="搜索本地技能或 MCP"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className={styles.meta} role="status">
        {loading
          ? '正在读取既有本地镜像…'
          : view === 'fab-skills'
            ? `共 ${visibleItems.length} 个 FAB 专用技能；安装只绑定当前助手。`
            : view === 'fab-mcp'
              ? `共 ${visibleItems.length} 个 FAB 本地 MCP；授权和配置只在 Fab 内完成。`
              : `显示 ${visibleItems.length} 个本地精选条目；无离线包或连接器定义时不会提供安装。`}
      </p>
      {error && <p role="alert">本地镜像暂时不可用，请稍后重试。</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <div className={styles.capabilityGrid}>
        {visibleItems.map((item) => (
          <article
            className={styles.capabilityCard}
            data-capability-id={item.id}
            data-capability-view={view}
            key={`${view}:${item.id}`}
          >
            <Avatar
              avatar={item.avatar || (view.endsWith('mcp') ? '🔌' : '🧰')}
              shape="square"
              size={36}
            />
            <div className={styles.capabilityBody}>
              <strong>{item.name}</strong>
              <span className={styles.description}>{item.description}</span>
              <span className={styles.meta}>
                {view === 'fab-skills'
                  ? 'FAB 专用 · 本地内置'
                  : view === 'fab-mcp'
                    ? `FAB 本地 · ${item.status === 'needs-config' ? '需配置' : '可用'}`
                    : `${item.source === 'local-mirror' ? '本地镜像' : 'FAB 本地'} · ${item.status === 'needs-config' ? '需配置' : '仅元数据'}`}
                {item.stars !== undefined ? ` · ★ ${item.stars.toLocaleString()}` : ''}
              </span>
            </div>
            <div className={styles.capabilityAction}>{renderAction(item)}</div>
          </article>
        ))}
      </div>
      <CustomConnectorModal
        agentId={targetAgentId}
        initialMetadata={connectorPreset?.metadata}
        initialValue={connectorPreset?.value}
        open={Boolean(connectorPreset)}
        onClose={() => setConnectorPreset(undefined)}
        onEditSuccess={() => {
          if (targetAgentId) void fetchAgentConnectors(targetAgentId);
          setConnectorPreset(undefined);
        }}
      />
    </section>
  );
};

export default AgentCapabilityStore;
