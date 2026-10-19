'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Select } from '@lobehub/ui/base-ui';
import { Empty, Input, message, Tag } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminBulkActionFlow from './AdminBulkActionFlow';
import type { AdminDangerousActionEnvelope } from './adminDangerousActions';
import {
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
} from './layout';

type StatusFilter = 'all' | 'pending' | 'completed' | 'canceled' | 'rejected';

const STATUS_COLORS: Record<string, string> = {
  canceled: 'default',
  completed: 'success',
  pending: 'processing',
  rejected: 'error',
};

const REASON_COLORS: Record<string, string> = {
  cycle_change: 'cyan',
  downgrade: 'orange',
  upgrade: 'gold',
};

type AdminChangeRequestsPageProps = {
  embedded?: boolean;
};

const AdminChangeRequestsPage = memo<AdminChangeRequestsPageProps>(({ embedded = false }) => {
  const { t } = useTranslation('subscription');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [cursorStack, setCursorStack] = useState([0]);
  const cursor = cursorStack.at(-1) ?? 0;
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; reason: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const swrKey = useMemo(
    () => ['admin-change-requests', status, userIdFilter, cursor] as const,
    [status, userIdFilter, cursor],
  );

  const { data, error, isLoading, mutate } = useClientDataSWR(swrKey, () =>
    adminCommercialService.listChangeRequests({
      cursor,
      limit: 50,
      status: status === 'all' ? undefined : status,
      userId: userIdFilter || undefined,
    }),
  );

  useEffect(() => {
    setSelectedIds([]);
  }, [cursor, status, userIdFilter]);

  const items = data?.items ?? [];

  const handleApprove = async (id: string) => {
    setSubmitting(id);
    try {
      await adminCommercialService.approveChangeRequest(id);
      message.success(t('admin.changeRequests.approveSuccess', '已通过'));
      await mutate();
    } catch {
      message.error(t('admin.changeRequests.approveFailed', '通过失败'));
    } finally {
      setSubmitting(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    setSubmitting(rejectTarget.id);
    try {
      await adminCommercialService.rejectChangeRequest({
        reason: rejectTarget.reason || undefined,
        requestId: rejectTarget.id,
      });
      message.success(t('admin.changeRequests.rejectSuccess', '已拒绝'));
      setRejectTarget(null);
      await mutate();
    } catch {
      message.error(t('admin.changeRequests.rejectFailed', '拒绝失败'));
    } finally {
      setSubmitting(null);
    }
  };

  const handleBulkApprove = async (
    command: AdminDangerousActionEnvelope<'subscription.changeRequest.bulkApprove'>,
  ) => {
    return adminCommercialService.bulkApproveChangeRequests(selectedIds, command);
  };

  const handleBulkReject = async (
    command: AdminDangerousActionEnvelope<'subscription.changeRequest.bulkReject'>,
  ) => {
    return adminCommercialService.bulkRejectChangeRequests(
      {
        reason: command.reason?.trim() || undefined,
        requestIds: selectedIds,
      },
      command,
    );
  };

  const finishBulkAction = async () => {
    setSelectedIds([]);
    await mutate();
  };

  const formatBulkApproveChangeRequestResult = (value: unknown) => {
    const result = value as { results: { ok: boolean; requestId: string }[] };
    const succeeded = result.results.filter((item) => item.ok).length;
    const failed = result.results.length - succeeded;

    return {
      failed,
      requested: result.results.length,
      succeeded,
      title: t('admin.changeRequests.bulkApproveDone', `已通过 ${succeeded} 个，失败 ${failed} 个`),
    };
  };

  const formatBulkRejectChangeRequestResult = (value: unknown) => {
    const result = value as { results: { ok: boolean; requestId: string }[] };
    const succeeded = result.results.filter((item) => item.ok).length;
    const failed = result.results.length - succeeded;

    return {
      failed,
      requested: result.results.length,
      succeeded,
      title: t('admin.changeRequests.bulkRejectDone', `已拒绝 ${succeeded} 个，失败 ${failed} 个`),
    };
  };

  const columns = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: Date) => new Date(value).toLocaleString(),
      title: t('admin.changeRequests.col.created', '创建时间'),
      width: 170,
    },
    {
      dataIndex: 'userId',
      key: 'userId',
      render: (value: string) => <code>{value?.slice(0, 8)}</code>,
      title: t('admin.changeRequests.col.user', '用户'),
    },
    {
      dataIndex: 'fromPlan',
      key: 'fromPlan',
      render: (value: string) => <Tag>{value}</Tag>,
      title: t('admin.changeRequests.col.from', '原套餐'),
    },
    {
      dataIndex: 'toPlan',
      key: 'toPlan',
      render: (value: string) => <Tag color="blue">{value}</Tag>,
      title: t('admin.changeRequests.col.to', '目标套餐'),
    },
    {
      dataIndex: 'cycle',
      key: 'cycle',
      title: t('admin.changeRequests.col.cycle', '周期'),
    },
    {
      dataIndex: 'reason',
      key: 'reason',
      render: (value: string) => <Tag color={REASON_COLORS[value] ?? 'default'}>{value}</Tag>,
      title: t('admin.changeRequests.col.reason', '原因'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => <Tag color={STATUS_COLORS[value] ?? 'default'}>{value}</Tag>,
      title: t('admin.changeRequests.col.status', '状态'),
    },
    {
      key: 'actions',
      render: (_: unknown, row: any) =>
        row.status === 'pending' ? (
          <Flexbox horizontal gap={6}>
            <Button
              loading={submitting === row.id}
              size="small"
              type="primary"
              onClick={() => handleApprove(row.id)}
            >
              {t('admin.changeRequests.approve', '通过')}
            </Button>
            <Button
              danger
              loading={submitting === row.id}
              size="small"
              onClick={() => setRejectTarget({ id: row.id, reason: '' })}
            >
              {t('admin.changeRequests.reject', '拒绝')}
            </Button>
          </Flexbox>
        ) : (
          '-'
        ),
      title: t('admin.changeRequests.col.actions', '操作'),
    },
  ];

  const content = (
    <Flexbox gap={24}>
      {error ? (
        <AdminPageError
          description={t('admin.changeRequests.loadFailed', '套餐变更请求加载失败，请重试。')}
          onRetry={mutate}
        />
      ) : null}

      <AdminToolbar>
        <Flexbox horizontal gap={12} style={{ flex: '1 1 420px', flexWrap: 'wrap' }}>
          <Select
            style={{ width: 160 }}
            value={status}
            options={[
              { label: t('admin.changeRequests.status.all', '全部'), value: 'all' },
              { label: t('admin.changeRequests.status.pending', '待处理'), value: 'pending' },
              { label: t('admin.changeRequests.status.completed', '已完成'), value: 'completed' },
              { label: t('admin.changeRequests.status.canceled', '已取消'), value: 'canceled' },
              { label: t('admin.changeRequests.status.rejected', '已拒绝'), value: 'rejected' },
            ]}
            onChange={(value: StatusFilter) => {
              setStatus(value);
              setCursorStack([0]);
            }}
          />
          <Input
            allowClear
            placeholder={t('admin.changeRequests.filter.user', '用户 ID')}
            style={{ width: 240 }}
            value={userIdFilter}
            onChange={(event: { target: { value: string } }) => {
              setUserIdFilter(event.target.value);
              setCursorStack([0]);
            }}
          />
        </Flexbox>
      </AdminToolbar>

      {!error && !isLoading && items.length === 0 ? (
        <Empty description={t('admin.changeRequests.empty', '暂无变更请求')} />
      ) : (
        <>
          {selectedIds.length > 0 && (
            <AdminToolbar>
              <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                <AdminBulkActionFlow
                  actionId="subscription.changeRequest.bulkApprove"
                  count={selectedIds.length}
                  size="small"
                  summary={formatBulkApproveChangeRequestResult}
                  type="primary"
                  confirmTitle={t(
                    'admin.changeRequests.confirmBulkApprove',
                    `确认通过 ${selectedIds.length} 个套餐变更请求？`,
                  )}
                  progressDescription={t(
                    'admin.changeRequests.bulkApproveProgress',
                    '正在通过选中的套餐变更请求，请勿关闭页面。',
                  )}
                  onRun={handleBulkApprove}
                  onSuccess={finishBulkAction}
                >
                  {t('admin.changeRequests.bulkApprove', `批量通过（${selectedIds.length}）`)}
                </AdminBulkActionFlow>
                <AdminBulkActionFlow
                  danger
                  actionId="subscription.changeRequest.bulkReject"
                  count={selectedIds.length}
                  size="small"
                  summary={formatBulkRejectChangeRequestResult}
                  confirmTitle={t(
                    'admin.changeRequests.confirmBulkReject',
                    `确认拒绝 ${selectedIds.length} 个套餐变更请求？`,
                  )}
                  progressDescription={t(
                    'admin.changeRequests.bulkRejectProgress',
                    '正在拒绝选中的套餐变更请求，请勿关闭页面。',
                  )}
                  onRun={handleBulkReject}
                  onSuccess={finishBulkAction}
                >
                  {t('admin.changeRequests.bulkReject', `批量拒绝（${selectedIds.length}）`)}
                </AdminBulkActionFlow>
                <Button size="small" onClick={() => setSelectedIds([])}>
                  {t('admin.changeRequests.clearSel', '清空选择')}
                </Button>
              </Flexbox>
            </AdminToolbar>
          )}
          <AdminSection
            title={t('admin.changeRequests.tableTitle', '套餐变更请求')}
            description={t(
              'admin.changeRequests.tableDescription',
              '只允许对待处理请求执行审批或拒绝，批量操作会要求再次确认。',
            )}
          >
            <AdminResponsiveTable label="套餐变更请求表格">
              <InlineTable
                columns={columns}
                dataSource={items}
                loading={isLoading}
                rowKey="id"
                rowSelection={{
                  getCheckboxProps: (row: any) => ({ disabled: row.status !== 'pending' }),
                  onChange: (keys) => setSelectedIds(keys as string[]),
                  selectedRowKeys: selectedIds,
                }}
              />
            </AdminResponsiveTable>
          </AdminSection>
        </>
      )}

      {(cursorStack.length > 1 || data?.nextCursor != null) && (
        <AdminToolbar>
          <Flexbox horizontal align="center" gap={8}>
            <Button
              disabled={cursorStack.length === 1}
              onClick={() =>
                setCursorStack((current) => (current.length > 1 ? current.slice(0, -1) : current))
              }
            >
              {t('admin.pagination.previous', '上一页')}
            </Button>
            <Button
              disabled={data?.nextCursor == null}
              loading={isLoading}
              onClick={() => setCursorStack((current) => [...current, data!.nextCursor!])}
            >
              {t('admin.pagination.next', '下一页')}
            </Button>
          </Flexbox>
        </AdminToolbar>
      )}

      <Modal
        confirmLoading={!!submitting}
        open={!!rejectTarget}
        title={t('admin.changeRequests.rejectTitle', '拒绝变更请求')}
        onCancel={() => setRejectTarget(null)}
        onOk={handleRejectConfirm}
      >
        <Flexbox gap={8}>
          <div>{t('admin.changeRequests.rejectReason', '原因（可选）')}</div>
          <Input.TextArea
            placeholder={t('admin.changeRequests.rejectPlaceholder', '请输入拒绝原因')}
            rows={3}
            value={rejectTarget?.reason ?? ''}
            onChange={(event: { target: { value: string } }) =>
              setRejectTarget((prev) => (prev ? { ...prev, reason: event.target.value } : prev))
            }
          />
        </Flexbox>
      </Modal>
    </Flexbox>
  );

  return embedded ? (
    content
  ) : (
    <AdminPageShell
      description={t('admin.changeRequests.subtitle', '集中处理套餐升级、降级和周期变更请求。')}
      title={t('admin.changeRequests.title', '套餐变更请求')}
      width="full"
    >
      {content}
    </AdminPageShell>
  );
});

AdminChangeRequestsPage.displayName = 'AdminChangeRequestsPage';

export default AdminChangeRequestsPage;
