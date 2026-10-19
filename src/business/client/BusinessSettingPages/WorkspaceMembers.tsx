'use client';

import {
  Alert,
  Button,
  confirmModal,
  Input,
  Select,
  Switch,
  Tooltip,
} from '@lobehub/ui/base-ui';
import { Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, Search, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import useSWR from 'swr';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { getWorkspacePilotError } from '@/business/client/workspacePilotError';
import type { WorkspaceMemberSummary } from '@/business/server/lambda-routers/workspaceMember';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import BusinessSettingsPageShell from './BusinessSettingsPageShell';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  `,
  code: css`
    overflow-wrap: anywhere;
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  content: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    min-width: 0;
  `,
  lookup: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    > input {
      flex: 1;
      min-width: 230px;
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    padding-block: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

type Role = 'admin' | 'member' | 'viewer';
type LookupResult = Awaited<ReturnType<typeof lambdaClient.workspaceMember.lookupByUserId.query>>;

const roleOptions = [
  { label: '管理员', value: 'admin' },
  { label: '成员', value: 'member' },
  { label: '查看者', value: 'viewer' },
] as const;

const memberName = (row: WorkspaceMemberSummary) =>
  row.user?.fullName || row.user?.username || row.userId;

const WorkspaceMembers = () => {
  const workspace = useActiveWorkspace();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  const isOwner = workspace?.role === 'owner';
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [targetId, setTargetId] = useState('');
  const lookupVersion = useRef(0);
  const [candidate, setCandidate] = useState<LookupResult>();
  const [addRole, setAddRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const {
    data,
    error: listError,
    isLoading,
    mutate,
  } = useSWR<WorkspaceMemberSummary[]>(
    workspace?.id ? ['fab/workspace/members', workspace.id, includeDeleted] : null,
    () => lambdaClient.workspaceMember.list.query({ includeDeleted }),
    { revalidateOnFocus: true },
  );

  const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
      await mutate();
      setSuccess(successMessage);
    } catch (cause) {
      setError(getWorkspacePilotError(cause));
    } finally {
      setBusy(false);
    }
  };

  const lookup = async () => {
    const userId = targetId.trim();
    if (!canManage || !userId) return;
    const version = ++lookupVersion.current;
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    setCandidate(undefined);
    try {
      const result = await lambdaClient.workspaceMember.lookupByUserId.query({ userId });
      if (version === lookupVersion.current) setCandidate(result);
    } catch (cause) {
      if (version === lookupVersion.current) setError(getWorkspacePilotError(cause));
    } finally {
      setBusy(false);
    }
  };

  const addMember = () => {
    if (!candidate || !workspace || !canManage) return;
    const role = !isOwner && addRole === 'admin' ? 'member' : addRole;
    confirmModal({
      cancelText: '取消',
      content: `将 ${candidate.user?.fullName || candidate.user?.username || candidate.userId} 加入「${workspace.name}」，角色为${roleOptions.find((option) => option.value === role)?.label}。此操作只授予该工作区成员资格。`,
      okText: '确认加入',
      onOk: () =>
        runMutation(async () => {
          await lambdaClient.workspaceMember.addByUserId.mutate({
            role,
            userId: candidate.userId,
          });
          setCandidate(undefined);
          setTargetId('');
        }, '成员已加入工作区。'),
      title: '确认加入成员',
    });
  };

  const changeRole = (row: WorkspaceMemberSummary, role: Role) => {
    if (!workspace || !canManage || row.role === role) return;
    confirmModal({
      cancelText: '取消',
      content: `将「${workspace.name}」中 ${memberName(row)} 的角色由 ${row.role} 改为 ${role}？`,
      okText: '确认更改',
      onOk: () =>
        runMutation(
          () =>
            lambdaClient.workspaceMember.changeRoleByUserId.mutate({ role, userId: row.userId }),
          '成员角色已更新。',
        ),
      title: '确认更改角色',
    });
  };

  const revoke = (row: WorkspaceMemberSummary) => {
    if (!workspace || !canManage) return;
    confirmModal({
      cancelText: '取消',
      content: `将 ${memberName(row)} 从「${workspace.name}」撤权？该成员将不能继续访问此工作区，历史审计保留。`,
      okText: '确认撤权',
      onOk: () =>
        runMutation(
          () => lambdaClient.workspaceMember.revokeByUserId.mutate({ userId: row.userId }),
          '成员已撤权。',
        ),
      title: '确认撤权',
    });
  };

  return (
    <BusinessSettingsPageShell title="成员管理">
      <div className={styles.content}>
        {!workspace && <Alert showIcon message="当前工作区尚未加载。" type="info" />}
        {workspace && !canManage && (
          <Alert showIcon message="只有工作区所有者或管理员可以管理成员。" type="warning" />
        )}
        {error && <Alert showIcon message={error} type="error" />}
        {success && <Alert showIcon message={success} type="success" />}

        {canManage && (
          <section className={styles.section}>
            <h2>加入成员</h2>
            <div className={styles.lookup}>
              <Input
                aria-label="Fab 用户 ID"
                placeholder="输入已完成 Casdoor 登录的 Fab 用户 ID"
                value={targetId}
                onPressEnter={() => void lookup()}
                onChange={(event) => {
                  lookupVersion.current++;
                  setTargetId(event.target.value);
                  setCandidate(undefined);
                }}
              />
              <Button
                disabled={!targetId.trim() || busy}
                loading={busy}
                onClick={() => void lookup()}
              >
                <Search aria-hidden size={16} /> 查询
              </Button>
            </div>
            {candidate && (
              <div className={styles.actions}>
                <span>
                  {candidate.user?.fullName || candidate.user?.username || '已绑定用户'}{' '}
                  <code className={styles.code}>{candidate.userId}</code>
                </span>
                <Select
                  aria-label="新成员角色"
                  options={roleOptions.filter((option) => isOwner || option.value !== 'admin')}
                  style={{ width: 116 }}
                  value={addRole}
                  onChange={(value) => {
                    if (value && !Array.isArray(value)) setAddRole(value);
                  }}
                />
                <Button disabled={busy} type="primary" onClick={addMember}>
                  <UserPlus aria-hidden size={16} /> 加入工作区
                </Button>
              </div>
            )}
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.actions}>
            <h2>当前成员</h2>
            {canManage && (
              <label className={styles.actions}>
                <Switch
                  aria-label="显示已撤权成员"
                  checked={includeDeleted}
                  onChange={setIncludeDeleted}
                />
                显示已撤权
              </label>
            )}
            <Tooltip title="刷新成员">
              <Button aria-label="刷新成员" size="small" onClick={() => void mutate()}>
                <RefreshCw aria-hidden size={16} />
              </Button>
            </Tooltip>
          </div>
          {listError && <Alert showIcon message={getWorkspacePilotError(listError)} type="error" />}
          <Table<WorkspaceMemberSummary>
            dataSource={listError ? [] : (data ?? [])}
            loading={isLoading}
            pagination={{ pageSize: 10 }}
            rowKey="userId"
            scroll={{ x: 700 }}
            columns={[
              {
                key: 'person',
                render: (_, row) => (
                  <div>
                    <div>{memberName(row)}</div>
                    <code className={styles.code}>{row.userId}</code>
                  </div>
                ),
                title: '成员',
              },
              { dataIndex: 'role', key: 'role', title: '角色', width: 120 },
              {
                key: 'status',
                render: (_, row) => (row.deletedAt ? '已撤权' : '活跃'),
                title: '状态',
                width: 100,
              },
              {
                key: 'updatedAt',
                render: (_, row) => new Date(row.updatedAt).toLocaleString(),
                title: '最后变更',
                width: 180,
              },
              {
                key: 'actions',
                render: (_, row) =>
                  canManage && !row.deletedAt && row.role !== 'owner' ? (
                    <div className={styles.actions}>
                      <Select
                        aria-label={`调整 ${memberName(row)} 的角色`}
                        style={{ width: 116 }}
                        value={row.role as Role}
                        disabled={
                          busy || row.userId === currentUserId || (row.role === 'admin' && !isOwner)
                        }
                        options={roleOptions.filter(
                          (option) => isOwner || option.value !== 'admin',
                        )}
                        onChange={(role) => {
                          if (role && !Array.isArray(role)) changeRole(row, role);
                        }}
                      />
                      <Button
                        size="small"
                        disabled={
                          busy || row.userId === currentUserId || (row.role === 'admin' && !isOwner)
                        }
                        onClick={() => revoke(row)}
                      >
                        撤权
                      </Button>
                    </div>
                  ) : null,
                title: '操作',
                width: 210,
              },
            ]}
          />
        </section>
      </div>
    </BusinessSettingsPageShell>
  );
};

export default WorkspaceMembers;
