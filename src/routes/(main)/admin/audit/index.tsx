'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { DatePicker, Descriptions, Empty, Input, message, Tag } from 'antd';
import { type Dayjs } from 'dayjs';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import InlineTable from '@/components/InlineTable';
import AdminUserDetailDrawer from '@/features/Admin/AdminUserDetailDrawer';
import {
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
} from '@/features/Admin/layout';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

const ACTION_COLORS: Record<string, string> = {
  'credits.adjust': 'gold',
  'order.forceSettle': 'green',
  'order.refund': 'red',
  'plan.delete': 'red',
  'plan.setActive': 'blue',
  'plan.update': 'cyan',
  'subscription.forceChange': 'purple',
  'topupPackage.delete': 'red',
  'topupPackage.setActive': 'blue',
  'topupPackage.update': 'cyan',
  'user.ban': 'red',
  'user.setRole': 'purple',
  'user.unban': 'green',
};

interface AuditRow {
  action: string;
  actorUserId: string | null;
  createdAt: Date;
  id: string;
  ipAddress: string | null;
  payload: Record<string, unknown> | null;
  resourceId: string | null;
  resourceType: string | null;
  targetUserId: string | null;
}

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
};

const downloadCsv = (rows: AuditRow[]) => {
  const header = [
    'createdAt',
    'action',
    'actorUserId',
    'targetUserId',
    'resourceType',
    'resourceId',
    'ipAddress',
    'payload',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        new Date(r.createdAt).toISOString(),
        r.action,
        r.actorUserId,
        r.targetUserId,
        r.resourceType,
        r.resourceId,
        r.ipAddress,
        r.payload,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `admin-audit-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.csv`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
};

const AdminAuditPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [searchParams] = useSearchParams();
  const [actorFilter, setActorFilter] = useState(() => searchParams.get('actorUserId') ?? '');
  const [targetFilter, setTargetFilter] = useState(() => searchParams.get('targetUserId') ?? '');
  const [actionFilter, setActionFilter] = useState(() => searchParams.get('action') ?? '');
  const [resourceTypeFilter, setResourceTypeFilter] = useState(
    () => searchParams.get('resourceType') ?? '',
  );
  const [resourceIdFilter, setResourceIdFilter] = useState(
    () => searchParams.get('resourceId') ?? '',
  );
  const [dateRangeFilter, setDateRangeFilter] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [drawerUser, setDrawerUser] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fromFilter = dateRangeFilter?.[0]?.startOf('day').toISOString();
  const toFilter = dateRangeFilter?.[1]?.endOf('day').toISOString();

  const swrKey = useMemo(
    () =>
      [
        'admin-audit',
        actorFilter,
        targetFilter,
        actionFilter,
        resourceTypeFilter,
        resourceIdFilter,
        fromFilter,
        toFilter,
        cursor,
      ] as const,
    [
      actorFilter,
      targetFilter,
      actionFilter,
      resourceTypeFilter,
      resourceIdFilter,
      fromFilter,
      toFilter,
      cursor,
    ],
  );

  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(swrKey, () =>
    adminCommercialService.listAudit({
      action: actionFilter || undefined,
      actorUserId: actorFilter || undefined,
      cursor,
      from: fromFilter,
      limit: 50,
      resourceId: resourceIdFilter || undefined,
      resourceType: resourceTypeFilter || undefined,
      targetUserId: targetFilter || undefined,
      to: toFilter,
    }),
  );

  const items = (data?.items ?? []) as AuditRow[];

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await adminCommercialService.exportAudit({
        action: actionFilter || undefined,
        actorUserId: actorFilter || undefined,
        from: fromFilter,
        limit: 5000,
        resourceId: resourceIdFilter || undefined,
        resourceType: resourceTypeFilter || undefined,
        targetUserId: targetFilter || undefined,
        to: toFilter,
      });
      downloadCsv(res.items as AuditRow[]);
      message.success(t('admin.audit.exportSuccess', `已导出 ${res.items.length} 行`));
    } catch {
      message.error(t('admin.audit.exportFailed', '导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: Date) => new Date(v).toLocaleString(),
      title: t('admin.audit.col.time', '时间'),
      width: 180,
    },
    {
      dataIndex: 'action',
      key: 'action',
      render: (v: string) => <Tag color={ACTION_COLORS[v] ?? 'default'}>{v}</Tag>,
      title: t('admin.audit.col.action', '操作'),
    },
    {
      dataIndex: 'actorUserId',
      key: 'actor',
      render: (v: string | null) =>
        v ? (
          <a
            onClick={(e) => {
              e.stopPropagation();
              setDrawerUser(v);
            }}
          >
            <code>{v.slice(0, 8)}</code>
          </a>
        ) : (
          '—'
        ),
      title: t('admin.audit.col.actor', '操作者'),
    },
    {
      dataIndex: 'targetUserId',
      key: 'target',
      render: (v: string | null) =>
        v ? (
          <a
            onClick={(e) => {
              e.stopPropagation();
              setDrawerUser(v);
            }}
          >
            <code>{v.slice(0, 8)}</code>
          </a>
        ) : (
          '—'
        ),
      title: t('admin.audit.col.target', '目标用户'),
    },
    {
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (v: string | null) => v ?? '—',
      title: t('admin.audit.col.resourceType', '资源'),
    },
    {
      dataIndex: 'resourceId',
      key: 'resourceId',
      render: (v: string | null) => (v ? <code>{v.slice(0, 16)}</code> : '—'),
      title: t('admin.audit.col.resourceId', '资源 ID'),
    },
    {
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      render: (v: string | null) => (v ? <code>{v}</code> : '—'),
      title: t('admin.audit.col.ip', 'IP'),
    },
    {
      dataIndex: 'payload',
      key: 'payload',
      render: (v: Record<string, unknown> | null) =>
        v ? (
          <code style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden' }}>
            {JSON.stringify(v).slice(0, 100)}
          </code>
        ) : (
          '—'
        ),
      title: t('admin.audit.col.payload', '载荷（Payload）'),
    },
  ];

  return (
    <AdminPageShell
      description={t('admin.audit.description', '检索管理员操作、目标对象和资源变更，并按筛选条件导出审计记录。')}
      title={t('admin.audit.title', '审计记录')}
      width="full"
    >
      <AdminSection
        description={t('admin.audit.resultSummary', '按操作者、目标、资源或时间范围筛选。')}
        title={t('admin.audit.listTitle', '操作日志')}
      >
        <AdminToolbar>
          <Flexbox
            horizontal
            align="center"
            gap={12}
            style={{ flex: '1 1 520px', flexWrap: 'wrap' }}
          >
            <Input
              allowClear
              placeholder={t('admin.audit.filter.actor', '操作者用户 ID')}
              style={{ width: 'min(240px, 100%)' }}
              value={actorFilter}
              onChange={(e: { target: { value: string } }) => {
                setActorFilter(e.target.value);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.audit.filter.target', '目标用户 ID')}
              style={{ width: 'min(240px, 100%)' }}
              value={targetFilter}
              onChange={(e: { target: { value: string } }) => {
                setTargetFilter(e.target.value);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.audit.filter.action', '操作（如 user.ban）')}
              style={{ width: 'min(240px, 100%)' }}
              value={actionFilter}
              onChange={(e: { target: { value: string } }) => {
                setActionFilter(e.target.value);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.audit.filter.resourceType', '资源类型')}
              style={{ width: 'min(180px, 100%)' }}
              value={resourceTypeFilter}
              onChange={(e: { target: { value: string } }) => {
                setResourceTypeFilter(e.target.value);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.audit.filter.resourceId', '资源 ID')}
              style={{ width: 'min(240px, 100%)' }}
              value={resourceIdFilter}
              onChange={(e: { target: { value: string } }) => {
                setResourceIdFilter(e.target.value);
                setCursor(0);
              }}
            />
            <DatePicker.RangePicker
              allowClear
              format="YYYY/MM/DD"
              style={{ width: 'min(260px, 100%)' }}
              value={dateRangeFilter}
              onChange={(values) => {
                setDateRangeFilter(values ? [values[0], values[1]] : null);
                setCursor(0);
              }}
            />
            <Button loading={exporting} onClick={handleExport}>
              {t('admin.audit.exportCsv', '导出 CSV')}
            </Button>
          </Flexbox>
        </AdminToolbar>

        {error ? (
          <AdminPageError
            description={t('admin.audit.loadFailed', '审计日志加载失败，请重试。')}
            onRetry={refresh}
          />
        ) : !isLoading && items.length === 0 ? (
          <Empty description={t('admin.audit.empty', '暂无审计日志')} />
        ) : (
          <AdminResponsiveTable label={t('admin.audit.tableLabel', '审计日志表')}>
            <InlineTable
              columns={columns}
              dataSource={items}
              loading={isLoading}
              rowKey="id"
              onRow={(record) => ({
                onClick: () => setDetail(record as AuditRow),
                style: { cursor: 'pointer' },
              })}
            />
          </AdminResponsiveTable>
        )}

        {data?.nextCursor != null && (
          <Flexbox align="center">
            <Button loading={isLoading} onClick={() => setCursor(data.nextCursor!)}>
              {t('admin.audit.loadMore', '加载更多')}
            </Button>
          </Flexbox>
        )}
      </AdminSection>

      <Modal
        footer={null}
        open={!!detail}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        title={t('admin.audit.detail.title', '审计日志详情')}
        width={720}
        onCancel={() => setDetail(null)}
      >
        {detail && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="ID">
              <code>{detail.id}</code>
            </Descriptions.Item>
            <Descriptions.Item label="时间">
              {new Date(detail.createdAt).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="操作">
              <Tag color={ACTION_COLORS[detail.action] ?? 'default'}>{detail.action}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="操作用户">{detail.actorUserId ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="目标用户">{detail.targetUserId ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="资源">
              {detail.resourceType ?? '—'} {detail.resourceId ? `· ${detail.resourceId}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="IP">{detail.ipAddress ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="载荷（Payload）">
              <pre
                style={{
                  fontSize: 12,
                  margin: 0,
                  maxHeight: 320,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {detail.payload ? JSON.stringify(detail.payload, null, 2) : '—'}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <AdminUserDetailDrawer userId={drawerUser} onClose={() => setDrawerUser(null)} />
    </AdminPageShell>
  );
});

AdminAuditPage.displayName = 'AdminAuditPage';

export default AdminAuditPage;
