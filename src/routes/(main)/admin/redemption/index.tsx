'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Select } from '@lobehub/ui/base-ui';
import {
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Tag,
} from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import AdminBulkActionFlow from '@/features/Admin/AdminBulkActionFlow';
import { formatAdminCredits, toAdminAtomicCredits } from '@/features/Admin/adminCreditUnits';
import type { AdminDangerousActionEnvelope } from '@/features/Admin/adminDangerousActions';
import {
  AdminPageError,
  AdminPageShell,
  AdminResponsiveTable,
  AdminSection,
  AdminToolbar,
} from '@/features/Admin/layout';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

type RewardType = 'plan' | 'credits' | 'topup_package';
type Status = 'all' | 'active' | 'redeemed' | 'disabled' | 'expired';

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  disabled: 'default',
  expired: 'warning',
  redeemed: 'blue',
};

const REWARD_COLORS: Record<RewardType, string> = {
  credits: 'gold',
  plan: 'purple',
  topup_package: 'cyan',
};

const escapeCsv = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const AdminRedemptionPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [status, setStatus] = useState<Status>('all');
  const [rewardType, setRewardType] = useState<RewardType | undefined>(undefined);
  const [batchId, setBatchId] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [genOpen, setGenOpen] = useState(false);
  const [genResult, setGenResult] = useState<{ batchId: string; codes: string[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genForm] = Form.useForm();

  const swrKey = useMemo(
    () => ['admin-redemption', status, rewardType, batchId, codeQuery, cursor] as const,
    [status, rewardType, batchId, codeQuery, cursor],
  );

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useClientDataSWR(swrKey, () =>
    adminCommercialService.listRedemptionCodes({
      batchId: batchId || undefined,
      codeQuery: codeQuery || undefined,
      cursor,
      limit: 50,
      rewardType,
      status: status === 'all' ? undefined : status,
    }),
  );
  const { data: plansData } = useClientDataSWR(['admin-redemption-plan-options'], () =>
    adminCommercialService.listPlans(),
  );
  const { data: packagesData } = useClientDataSWR(['admin-redemption-package-options'], () =>
    adminCommercialService.listPackages(),
  );

  const items = (data?.items ?? []) as any[];
  const planOptions = useMemo(() => {
    return ((plansData?.items ?? []) as any[])
      .filter((item) => item.isActive !== false)
      .map((item) => ({
        label: `${item.displayName || item.plan} (${item.plan})`,
        value: item.plan,
      }));
  }, [plansData?.items]);
  const packageOptions = useMemo(
    () =>
      ((packagesData?.items ?? []) as any[])
        .filter((item) => item.isActive !== false)
        .map((item) => ({
          label: `${item.displayName || item.id} (${item.id})`,
          value: item.id,
        })),
    [packagesData?.items],
  );

  const handleBulkDisable = async (
    command: AdminDangerousActionEnvelope<'redemption.bulkDisable'>,
  ) => adminCommercialService.bulkDisableRedemptionCodes(selectedIds, command);

  const handleBulkDelete = async (command: AdminDangerousActionEnvelope<'redemption.bulkDelete'>) =>
    adminCommercialService.bulkDeleteRedemptionCodes(
      {
        ids: selectedIds,
        reason: command.reason?.trim(),
      },
      command,
    );

  const finishBulkAction = async () => {
    setSelectedIds([]);
    await mutate();
  };

  const formatBulkDisableResult = (value: unknown) => {
    const result = value as { disabled: number; requested: number };

    return {
      requested: result.requested,
      succeeded: result.disabled,
      title: t(
        'admin.redemption.bulkDisableDone',
        `已停用 ${result.disabled}/${result.requested} 个`,
      ),
    };
  };

  const formatBulkDeleteResult = (value: unknown) => {
    const result = value as { deleted: number; requested: number };

    return {
      requested: result.requested,
      succeeded: result.deleted,
      title: t(
        'admin.redemption.bulkDeleteDone',
        `已删除 ${result.deleted}/${result.requested} 个`,
      ),
    };
  };

  const handleGenerate = async () => {
    try {
      const v = await genForm.validateFields();
      setGenerating(true);
      const payload: any = {
        codeLength: v.codeLength,
        count: v.count,
        batchId: v.batchId || undefined,
        expiresAt: v.expiresAt ? v.expiresAt.toISOString() : undefined,
        note: v.note || undefined,
        rewardType: v.rewardType,
      };
      if (v.rewardType === 'plan') {
        payload.planCycle = v.planCycle;
        payload.planDurationMonths = v.planDurationMonths;
        payload.planKey = v.planKey;
      } else if (v.rewardType === 'credits') {
        payload.creditsAmount = toAdminAtomicCredits(v.creditsAmount);
      } else {
        payload.topupPackageId = v.topupPackageId;
      }
      const res = await adminCommercialService.generateRedemptionCodes(payload);
      setGenResult(res);
      setGenOpen(false);
      genForm.resetFields();
      await mutate();
      message.success(t('admin.redemption.genSuccess', `已生成 ${res.codes.length} 个`));
    } catch (err: any) {
      if (err?.errorFields) return; // validation
      message.error(t('admin.redemption.genFailed', '生成失败'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDisable = async (id: string) => {
    try {
      await adminCommercialService.disableRedemptionCode(id);
      message.success(t('admin.redemption.disableSuccess', '已停用'));
      await mutate();
    } catch {
      message.error(t('admin.redemption.actionFailed', '操作失败'));
    }
  };
  const handleEnable = async (id: string) => {
    try {
      await adminCommercialService.enableRedemptionCode(id);
      message.success(t('admin.redemption.enableSuccess', '已启用'));
      await mutate();
    } catch {
      message.error(t('admin.redemption.actionFailed', '操作失败'));
    }
  };

  const handleExportBatch = () => {
    if (!genResult) return;
    const blob = new Blob([`code\n${genResult.codes.map((c) => escapeCsv(c)).join('\n')}\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.download = `redemption-${genResult.batchId}.csv`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const columns = [
    {
      dataIndex: 'code',
      key: 'code',
      render: (v: string) => <code>{v}</code>,
      title: t('admin.redemption.col.code', '兑换码'),
    },
    {
      dataIndex: 'rewardType',
      key: 'rewardType',
      render: (v: RewardType) => <Tag color={REWARD_COLORS[v]}>{v}</Tag>,
      title: t('admin.redemption.col.type', '类型'),
    },
    {
      key: 'reward',
      render: (_: unknown, r: any) =>
        r.rewardType === 'plan'
          ? `${r.planKey} / ${r.planCycle}${r.planDurationMonths ? ` / ${r.planDurationMonths} 个月` : ''}`
          : r.rewardType === 'credits'
            ? formatAdminCredits(r.creditsAmount)
            : r.topupPackageId,
      title: t('admin.redemption.col.reward', '奖励'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'default'}>{v}</Tag>,
      title: t('admin.redemption.col.status', '状态'),
    },
    {
      dataIndex: 'batchId',
      key: 'batchId',
      render: (v: string | null) => (v ? <code style={{ fontSize: 11 }}>{v}</code> : '-'),
      title: t('admin.redemption.col.batch', '批次'),
    },
    {
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : '-'),
      title: t('admin.redemption.col.expires', '过期时间'),
    },
    {
      dataIndex: 'redeemedByUserId',
      key: 'redeemedByUserId',
      render: (v: string | null) => (v ? <code>{v.slice(0, 8)}</code> : '-'),
      title: t('admin.redemption.col.redeemedBy', '兑换用户'),
    },
    {
      dataIndex: 'redeemedAt',
      key: 'redeemedAt',
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '-'),
      title: t('admin.redemption.col.redeemedAt', '兑换时间'),
    },
    {
      key: 'actions',
      render: (_: unknown, r: any) =>
        r.status === 'active' ? (
          <Button danger size="small" onClick={() => handleDisable(r.id)}>
            {t('admin.redemption.disable', '停用')}
          </Button>
        ) : r.status === 'disabled' ? (
          <Button size="small" type="primary" onClick={() => handleEnable(r.id)}>
            {t('admin.redemption.enable', '启用')}
          </Button>
        ) : (
          '-'
        ),
      title: t('admin.redemption.col.actions', '操作'),
    },
  ];

  return (
    <AdminPageShell
      description={t('admin.redemption.description', '生成、筛选和维护兑换码；批量操作需要经过受控确认。')}
      title={t('admin.redemption.title', '兑换码管理')}
      width="full"
    >
      <AdminSection
        description={t('admin.redemption.resultSummary', '按状态、奖励类型、批次或兑换码筛选。')}
        title={t('admin.redemption.listTitle', '兑换码列表')}
      >
        <AdminToolbar>
          <Flexbox
            horizontal
            align="center"
            gap={12}
            style={{ flex: '1 1 520px', flexWrap: 'wrap' }}
          >
            <Select
              style={{ width: 'min(140px, 100%)' }}
              value={status}
              options={[
                { label: t('admin.redemption.status.all', '全部'), value: 'all' },
                { label: t('admin.redemption.status.active', '可用'), value: 'active' },
                { label: t('admin.redemption.status.redeemed', '已兑换'), value: 'redeemed' },
                { label: t('admin.redemption.status.disabled', '已停用'), value: 'disabled' },
                { label: t('admin.redemption.status.expired', '已过期'), value: 'expired' },
              ]}
              onChange={(v: 'active' | 'all' | 'disabled' | 'expired' | 'redeemed') => {
                setStatus(v);
                setCursor(0);
              }}
            />
            <Select
              allowClear
              placeholder={t('admin.redemption.filter.type', '奖励类型')}
              style={{ width: 'min(180px, 100%)' }}
              value={rewardType}
              options={[
                { label: '套餐（Plan）', value: 'plan' },
                { label: '积分', value: 'credits' },
                { label: '充值套餐', value: 'topup_package' },
              ]}
              onChange={(v: RewardType | undefined) => {
                setRewardType(v);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.redemption.filter.batch', '批次 ID')}
              style={{ width: 'min(200px, 100%)' }}
              value={batchId}
              onChange={(e: { target: { value: string } }) => {
                setBatchId(e.target.value);
                setCursor(0);
              }}
            />
            <Input
              allowClear
              placeholder={t('admin.redemption.filter.code', '搜索兑换码...')}
              style={{ width: 'min(200px, 100%)' }}
              value={codeQuery}
              onChange={(e: { target: { value: string } }) => {
                setCodeQuery(e.target.value);
                setCursor(0);
              }}
            />
            <Flexbox horizontal gap={8} wrap="wrap">
              <Button type="primary" onClick={() => setGenOpen(true)}>
                {t('admin.redemption.generate', '生成兑换码')}
              </Button>
              {selectedIds.length > 0 && (
                <>
                  <AdminBulkActionFlow
                    danger
                    actionId="redemption.bulkDisable"
                    count={selectedIds.length}
                    summary={formatBulkDisableResult}
                    confirmTitle={t(
                      'admin.redemption.confirmBulkDisable',
                      `确认停用 ${selectedIds.length} 个兑换码？`,
                    )}
                    progressDescription={t(
                      'admin.redemption.bulkDisableProgress',
                      '正在停用选中的兑换码，请勿关闭页面。',
                    )}
                    onRun={handleBulkDisable}
                    onSuccess={finishBulkAction}
                  >
                    {t('admin.redemption.bulkDisable', `停用 ${selectedIds.length} 个`)}
                  </AdminBulkActionFlow>
                  <AdminBulkActionFlow
                    danger
                    actionId="redemption.bulkDelete"
                    count={selectedIds.length}
                    summary={formatBulkDeleteResult}
                    confirmTitle={t(
                      'admin.redemption.confirmBulkDelete',
                      `确认删除 ${selectedIds.length} 个未兑换兑换码？`,
                    )}
                    progressDescription={t(
                      'admin.redemption.bulkDeleteProgress',
                      '正在删除选中的未兑换兑换码，请勿关闭页面。',
                    )}
                    onRun={handleBulkDelete}
                    onSuccess={finishBulkAction}
                  >
                    {t('admin.redemption.bulkDelete', `删除 ${selectedIds.length} 个`)}
                  </AdminBulkActionFlow>
                  <Button onClick={() => setSelectedIds([])}>
                    {t('admin.redemption.clearSel', '清空选择')}
                  </Button>
                </>
              )}
              <Button
                onClick={async () => {
                  try {
                    const r = await adminCommercialService.expireOverdueRedemptionCodes();
                    message.success(t('admin.redemption.expireDone', `已过期 ${r.expired} 个兑换码`));
                    await mutate();
                  } catch {
                    message.error(t('admin.redemption.actionFailed', '操作失败'));
                  }
                }}
              >
                {t('admin.redemption.sweepExpired', '扫描过期兑换码')}
              </Button>
            </Flexbox>
          </Flexbox>
        </AdminToolbar>

        {error ? (
          <AdminPageError
            description={t('admin.redemption.loadFailed', '兑换码加载失败，请重试。')}
            onRetry={mutate}
          />
        ) : !isLoading && items.length === 0 ? (
          <Empty description={t('admin.redemption.empty', '暂无兑换码')} />
        ) : (
          <AdminResponsiveTable label={t('admin.redemption.tableLabel', '兑换码表')}>
            <InlineTable
              columns={columns as any}
              dataSource={items}
              loading={isLoading}
              rowKey="id"
              rowSelection={{
                getCheckboxProps: (row: any) => ({ disabled: row.status === 'redeemed' }),
                onChange: (keys) => setSelectedIds(keys as string[]),
                selectedRowKeys: selectedIds,
              }}
            />
          </AdminResponsiveTable>
        )}

        {data?.nextCursor != null && (
          <Flexbox align="center">
            <Button loading={isLoading} onClick={() => setCursor(data.nextCursor!)}>
              {t('admin.redemption.loadMore', '加载更多')}
            </Button>
          </Flexbox>
        )}
      </AdminSection>

      <Modal
        confirmLoading={generating}
        open={genOpen}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        title={t('admin.redemption.genTitle', '生成兑换码')}
        width={560}
        onCancel={() => setGenOpen(false)}
        onOk={handleGenerate}
      >
        <Form
          form={genForm}
          initialValues={{ codeLength: 16, count: 10, rewardType: 'credits' }}
          layout="vertical"
        >
          <Form.Item
            label={t('admin.redemption.field.rewardType', '奖励类型')}
            name="rewardType"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: '积分', value: 'credits' },
                { label: '套餐（Plan）', value: 'plan' },
                { label: '充值套餐', value: 'topup_package' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p: any, c: any) => p.rewardType !== c.rewardType}>
            {({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => {
              const rt = getFieldValue('rewardType') as RewardType;
              if (rt === 'plan')
                return (
                  <>
                    <Form.Item
                      label={t('admin.redemption.field.planKey', '套餐')}
                      name="planKey"
                      rules={[{ required: true }]}
                      extra={
                        planOptions.length === 0
                          ? t(
                              'admin.redemption.field.planKey.empty',
                              '暂无可用套餐，请先在套餐管理中启用套餐',
                            )
                          : undefined
                      }
                    >
                      <Select
                        disabled={planOptions.length === 0}
                        options={planOptions}
                        placeholder={t(
                          'admin.redemption.field.planKey.placeholder',
                          '请选择兑换后获得的套餐',
                        )}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t('admin.redemption.field.planCycle', '周期')}
                      name="planCycle"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { label: '月付', value: 'monthly' },
                          { label: '年付', value: 'yearly' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t('admin.redemption.field.planDuration', '套餐使用时长（月）')}
                      name="planDurationMonths"
                    >
                      <InputNumber max={60} min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                );
              if (rt === 'credits')
                return (
                  <Form.Item
                    label={t('admin.redemption.field.creditsAmount', '赠送积分数量')}
                    name="creditsAmount"
                    rules={[{ required: true }]}
                  >
                    <InputNumber
                      addonAfter={'M'}
                      min={0.000_001}
                      precision={6}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                );
              return (
                <Form.Item
                  label={t('admin.redemption.field.topupPackageId', '充值套餐')}
                  name="topupPackageId"
                  rules={[{ required: true }]}
                  extra={
                    packageOptions.length === 0
                      ? t(
                          'admin.redemption.field.topupPackageId.empty',
                          '暂无可用充值套餐，请先创建并启用',
                        )
                      : undefined
                  }
                >
                  <Select
                    disabled={packageOptions.length === 0}
                    options={packageOptions}
                    placeholder={t(
                      'admin.redemption.field.topupPackageId.placeholder',
                      '请选择兑换后获得的充值套餐',
                    )}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item label={t('admin.redemption.field.count', '生成数量')} name="count">
            <InputNumber max={1000} min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('admin.redemption.field.codeLength', '兑换码长度')} name="codeLength">
            <InputNumber max={32} min={8} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t('admin.redemption.field.expiresAt', '过期时间（可选）')}
            name="expiresAt"
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('admin.redemption.field.batchId', '批次 ID（可选）')} name="batchId">
            <Input />
          </Form.Item>
          <Form.Item label={t('admin.redemption.field.note', '备注（可选）')} name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!genResult}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        title={t('admin.redemption.generated', '兑换码已生成')}
        width={560}
        footer={[
          <Button key="csv" type="primary" onClick={handleExportBatch}>
            {t('admin.redemption.downloadCsv', '下载 CSV')}
          </Button>,
          <Button key="close" onClick={() => setGenResult(null)}>
            {t('admin.redemption.close', '关闭')}
          </Button>,
        ]}
        onCancel={() => setGenResult(null)}
      >
        {genResult && (
          <Flexbox gap={8}>
            <div>
              {t('admin.redemption.batch', '批次')}: <code>{genResult.batchId}</code>
            </div>
            <Input.TextArea
              readOnly
              rows={Math.min(15, genResult.codes.length)}
              value={genResult.codes.join('\n')}
            />
          </Flexbox>
        )}
      </Modal>
    </AdminPageShell>
  );
});

AdminRedemptionPage.displayName = 'AdminRedemptionPage';

export default AdminRedemptionPage;
