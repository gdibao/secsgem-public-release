'use client';

import { Button } from '@lobehub/ui/base-ui';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import useSWR from 'swr';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useEngineeringWorkspaceScope } from './useEngineeringWorkspace';
import { workspaceStyles as styles } from './workspaceStyles';

const permissionLabels: Record<string, string> = {
  auto: '自动调用配置', disabled: '已禁用', needs_approval: '调用需批准',
};
const connectionLabels: Record<string, string> = {
  connected: '连接记录：已连接', disconnected: '连接记录：未连接', error: '连接记录：错误',
};

export const loadConfiguredMcp = () => lambdaClient.engineeringTools.listConfiguredMcp.query();

const LocalMcpPanel = () => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const workspace = useActiveWorkspace();
  const { ready } = useEngineeringWorkspaceScope();
  const { data, error, isLoading, mutate } = useSWR(
    userId && ready ? ['engineering-configured-mcp', userId, workspaceId ?? 'global'] : null,
    loadConfiguredMcp,
    { revalidateOnFocus: true },
  );
  const managementPath = workspace && workspace.id === workspaceId
    ? `/${encodeURIComponent(workspace.slug)}/settings/connector` : null;

  return <section aria-label="本地工具与 MCP" className={styles.body}>
    <div className={styles.toolbar}>
      <h2 style={{ flex: '1 1 auto', margin: 0 }}>本地工具与 MCP</h2>
      <Button aria-label="刷新连接器清单" disabled={!ready} icon={<RefreshCw size={16} />} title="刷新连接器清单" onClick={() => void mutate()} />
      {managementPath && <Link to={managementPath}>管理连接器 <ExternalLink aria-hidden size={14} /></Link>}
    </div>
    <p className={styles.muted}>以下为当前身份可见的个人/工作区级 MCP 配置；不包含助理专属连接器。配置或连接记录不代表此刻健康、许可或可从工程工作区运行。本页不调用连接器。</p>
    {!ready && <p role="status">工作区加载中，暂不可读取连接器。</p>}
    {isLoading && <p role="status">读取连接器清单</p>}
    {error && <p role="alert">连接器清单读取失败，请刷新重试。</p>}
    {!isLoading && !error && data?.length === 0 && <p>当前个人/工作区范围暂无已配置的 MCP 连接器；助理专属连接器不在此清单。本地 CLI/SDK 尚无就绪证据。</p>}
    {data?.map((connector) => <section className={styles.row} key={connector.id}>
      <div style={{ flex: '1 1 100%', minWidth: 0 }}>
        <strong>{connector.name}</strong> <span className={styles.muted}>{connector.identifier}</span>
        <div className={styles.muted}>{connector.isEnabled ? connectionLabels[connector.status] ?? '连接状态未核' : '配置已停用'} · 当前健康与许可未核</div>
      </div>
      {connector.tools.length ? <ul style={{ margin: 0, paddingInlineStart: 20, minWidth: 0 }}>
        {connector.tools.map((tool) => <li key={tool.id} style={{ overflowWrap: 'anywhere' }}>
          {tool.displayName || tool.name} <span className={styles.muted}>({tool.name}) · {permissionLabels[tool.permission] ?? '权限待核'}</span>
        </li>)}
      </ul> : <span className={styles.muted}>尚无已同步的工具清单</span>}
    </section>)}
    {!managementPath && ready && <p className={styles.muted}>连接器管理入口仅在有权访问的工作区路由提供；当前页面不跳转其他工作区。</p>}
  </section>;
};

export default LocalMcpPanel;
