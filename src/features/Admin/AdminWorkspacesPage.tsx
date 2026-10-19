'use client';

import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Alert, Button, Input, TextArea } from '@lobehub/ui/base-ui';
import { Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useState } from 'react';
import { Link } from 'react-router';

import type { WorkspaceListItem } from '@/business/client/hooks/useActiveWorkspace';
import { useWorkspaceListQuery } from '@/business/client/hooks/useWorkspaces';
import { getWorkspacePilotError } from '@/business/client/workspacePilotError';
import { AdminPageError, AdminPageShell, AdminSection } from '@/features/Admin/layout';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

type CreateWorkspaceValues = { description?: string; name: string; slug: string };

const styles = createStaticStyles(({ css }) => ({
  field: css`
    display: grid;
    gap: 6px;
  `,
  form: css`
    display: grid;
    gap: 16px;
    max-width: 520px;
    padding-block-start: 16px;
  `,
}));

const AdminWorkspacesPage = () => {
  const role = useUserStore((state) => userProfileSelectors.userProfile(state)?.role);
  const canCreate = hasAdminCapability(role, ADMIN_CAPABILITIES.systemWrite);
  const { data, error: listError, isLoading, mutate } = useWorkspaceListQuery();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ name: string; slug: string }>();

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    if (
      slug.length < WORKSPACE_SLUG_MIN ||
      slug.length > WORKSPACE_SLUG_MAX ||
      !isWorkspaceSlugFormatValid(slug)
    ) {
      setError('请使用有效的工作区标识。');
      return;
    }
    const values: CreateWorkspaceValues = { name: name.trim(), slug };
    if (description.trim()) values.description = description.trim();
    setSubmitting(true);
    setError(undefined);
    setCreated(undefined);
    try {
      const workspace = await lambdaClient.workspace.create.mutate(values);
      await mutate();
      setCreated({ name: workspace.name, slug: workspace.slug });
      setName('');
      setSlug('');
      setDescription('');
    } catch (cause) {
      setError(getWorkspacePilotError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell title="工作区管理" width="medium">
      <AdminSection title="我的工作区">
        {listError ? (
          <AdminPageError title="工作区列表加载失败" onRetry={() => mutate()} />
        ) : (
          <Table<WorkspaceListItem>
            dataSource={data ?? []}
            loading={isLoading}
            pagination={false}
            rowKey="id"
            columns={[
              {
                dataIndex: 'name',
                key: 'name',
                render: (name: string, row) => (
                  <Link to={`/${row.slug}/settings/members`}>{name}</Link>
                ),
                title: '名称',
              },
              { dataIndex: 'slug', key: 'slug', title: '标识' },
              { dataIndex: 'role', key: 'role', title: '我的角色' },
            ]}
          />
        )}
      </AdminSection>

      {canCreate && (
        <AdminSection title="创建工作区">
          {created && (
            <Alert
              showIcon
              type="success"
              message={
                <>
                  已创建 {created.name}，当前账号为所有者。{' '}
                  <Link to={`/${created.slug}/settings/members`}>管理成员</Link>
                </>
              }
            />
          )}
          {error && <Alert showIcon message={error} type="error" />}
          <form className={styles.form} onSubmit={(event) => void createWorkspace(event)}>
            <label className={styles.field}>
              名称
              <Input
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              标识
              <Input
                required
                maxLength={WORKSPACE_SLUG_MAX}
                minLength={WORKSPACE_SLUG_MIN}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              说明
              <TextArea
                maxLength={1000}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <Button htmlType="submit" loading={submitting} type="primary">
              创建工作区
            </Button>
          </form>
        </AdminSection>
      )}
    </AdminPageShell>
  );
};

export default AdminWorkspacesPage;
