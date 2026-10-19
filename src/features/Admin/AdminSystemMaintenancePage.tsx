'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Modal, Select } from '@lobehub/ui/base-ui';
import { Alert, Descriptions, Form, Input, InputNumber, message, Typography } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import {
  type MemoryUserMemoryTriggerMode,
  normalizeMemoryUserMemoryTriggerMode,
  normalizeText,
  SETTING_KEYS,
} from '@/features/Admin/adminSettingsForm';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminDangerousActionButton from './AdminDangerousActionButton';
import type { AdminDangerousActionEnvelope } from './adminDangerousActions';
import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

const { Text } = Typography;

const memoryTriggerModeOptions = [
  { label: '自动选择', value: 'auto' },
  { label: '直接执行（推荐单机 Node 部署）', value: 'direct' },
  { label: 'QStash 工作流优先（缺失 Token 时回退直接执行）', value: 'workflow' },
] satisfies Array<{ label: string; value: MemoryUserMemoryTriggerMode }>;

type MaintenanceFormValues = {
  cronAuditRetentionDays: number;
  cronPendingOrderExpiryDays: number;
  cronSecret: string;
  memoryUserMemoryTriggerMode: MemoryUserMemoryTriggerMode;
};

type MaintenanceResult = {
  auditCutoff?: string;
  auditLogsDeleted?: number;
  freeSnapshotsCreated?: number;
  moduleAppUploadCleanupFailed?: number;
  moduleAppUploadsExpired?: number;
  notificationRetentionCutoff?: string;
  notificationsDeleted?: number;
  pendingOrdersCutoff?: string;
  pendingOrdersExpired?: number;
  subscriptionSnapshotsExpired?: number;
};

const buildInitialValues = (data: any): MaintenanceFormValues => ({
  cronAuditRetentionDays: data?.cronAuditRetentionDays ?? 365,
  cronPendingOrderExpiryDays: data?.cronPendingOrderExpiryDays ?? 7,
  cronSecret: '',
  memoryUserMemoryTriggerMode: normalizeMemoryUserMemoryTriggerMode(
    data?.memoryUserMemoryTriggerMode,
  ),
});

const normalizeValues = (values: MaintenanceFormValues): MaintenanceFormValues => ({
  cronAuditRetentionDays:
    typeof values.cronAuditRetentionDays === 'number' ? values.cronAuditRetentionDays : 365,
  cronPendingOrderExpiryDays:
    typeof values.cronPendingOrderExpiryDays === 'number' ? values.cronPendingOrderExpiryDays : 7,
  cronSecret: normalizeText(values.cronSecret),
  memoryUserMemoryTriggerMode: normalizeMemoryUserMemoryTriggerMode(
    values.memoryUserMemoryTriggerMode,
  ),
});

const buildUpdates = (values: MaintenanceFormValues, initial: MaintenanceFormValues) => {
  const current = normalizeValues(values);
  const baseline = normalizeValues(initial);
  const updates: { key: string; value: unknown }[] = [];

  if (current.cronSecret) {
    updates.push({ key: SETTING_KEYS.cronSecret, value: current.cronSecret });
  }

  const fields: Array<keyof MaintenanceFormValues> = [
    'cronAuditRetentionDays',
    'cronPendingOrderExpiryDays',
    'memoryUserMemoryTriggerMode',
  ];

  const keyMap: Record<keyof MaintenanceFormValues, string> = {
    cronAuditRetentionDays: SETTING_KEYS.cronAuditRetentionDays,
    cronPendingOrderExpiryDays: SETTING_KEYS.cronPendingOrderExpiryDays,
    cronSecret: SETTING_KEYS.cronSecret,
    memoryUserMemoryTriggerMode: SETTING_KEYS.memoryUserMemoryTriggerMode,
  };

  for (const field of fields) {
    if (current[field] !== baseline[field]) {
      updates.push({ key: keyMap[field], value: current[field] });
    }
  }

  return updates;
};

const AdminSystemMaintenancePage = memo(() => {
  const { t } = useTranslation('subscription');
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('maintenance'), () =>
    adminCommercialService.getSettingsSection('maintenance'),
  );
  const [form] = Form.useForm<MaintenanceFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshingCaches, setRefreshingCaches] = useState(false);
  const [runResult, setRunResult] = useState<MaintenanceResult | null>(null);

  const initialValues = useMemo(() => buildInitialValues(data), [data]);

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue(buildInitialValues(data));
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    try {
      const values = await form.validateFields();
      const updates = buildUpdates(values, initialValues);

      if (updates.length === 0) {
        message.info(t('admin.maintenance.noChanges', '没有需要保存的变更'));
        return;
      }

      setSubmitting(true);
      await adminCommercialService.setAppSettingsBatch({ updates });
      form.setFieldValue('cronSecret', '');
      message.success(t('admin.maintenance.saveSuccess', '系统维护设置已保存'));
    } catch {
      message.error(t('admin.maintenance.saveFailed', '保存失败，请检查维护配置'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunNow = async (command: AdminDangerousActionEnvelope<'setting.runMaintenance'>) => {
    if (!data) return;

    setRunning(true);
    try {
      const result = await adminCommercialService.runMaintenance(command);
      setRunResult(result);
      message.success(t('admin.maintenance.runSuccess', '维护任务已执行'));
    } catch {
      message.error(t('admin.maintenance.runFailed', '维护任务执行失败'));
    } finally {
      setRunning(false);
    }
  };

  const handleRefreshRuntimeCaches = async () => {
    if (!data) return;

    setRefreshingCaches(true);
    try {
      const result = await adminCommercialService.refreshRuntimeCaches();
      message.success(
        t('admin.maintenance.refreshCachesSuccess', '已刷新 {{count}} 类运行时缓存', {
          count: result.refreshed.length,
        }),
      );
    } catch {
      message.error(t('admin.maintenance.refreshCachesFailed', '刷新运行时缓存失败'));
    } finally {
      setRefreshingCaches(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.maintenance.title', '系统维护')}
      width="medium"
      description={t(
        'admin.maintenance.subtitle',
        '统一管理后台维护任务、数据保留策略和记忆分析任务执行方式。',
      )}
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.maintenance.help',
          '维护任务会清理过期审计日志、过期待支付订单和已归档通知；立即执行会使用当前已保存配置。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.maintenance.loadFailed', '无法读取当前维护配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}

      <Form
        disabled={isLoading || !data}
        form={form}
        initialValues={initialValues}
        layout="vertical"
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.maintenance.cronSection', '定时维护配置')}
            description={t(
              'admin.maintenance.cronSectionDescription',
              '设置维护接口密钥及后台数据保留周期。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.maintenance.cronSecret', 'Cron Bearer 密钥')}
                name="cronSecret"
                extra={
                  data?.cronSecretConfigured
                    ? `${t('admin.maintenance.current', '当前值')}: ${data.cronSecretMasked}`
                    : t('admin.maintenance.notSet', '未配置')
                }
              >
                <Input.Password
                  placeholder={t('admin.maintenance.leaveBlank', '留空则保持当前值')}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.maintenance.auditRetention', '审计日志保留天数')}
                name="cronAuditRetentionDays"
                extra={t(
                  'admin.maintenance.auditRetentionHelp',
                  '超过该天数的后台审计日志会被删除，范围 7-3650 天。',
                )}
              >
                <InputNumber max={3650} min={7} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                label={t('admin.maintenance.pendingOrderExpiry', '待支付订单过期天数')}
                name="cronPendingOrderExpiryDays"
                extra={t(
                  'admin.maintenance.pendingOrderExpiryHelp',
                  '超过该天数的待支付充值订单会自动过期，范围 1-365 天。',
                )}
              >
                <InputNumber max={365} min={1} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.maintenance.runtimeActions', '运行时操作')}
            description={t(
              'admin.maintenance.runtimeActionsDescription',
              '立即执行使用已保存配置；未保存的表单修改不会参与本次任务。',
            )}
          >
            <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
              <AdminDangerousActionButton
                actionId="setting.runMaintenance"
                disabled={isLoading || !data || refreshingCaches || submitting}
                loading={running}
                onConfirm={handleRunNow}
              >
                {t('admin.maintenance.runNow', '立即执行维护')}
              </AdminDangerousActionButton>
              <Button
                disabled={isLoading || !data || running || submitting}
                loading={refreshingCaches}
                onClick={handleRefreshRuntimeCaches}
              >
                {t('admin.maintenance.refreshCaches', '刷新用户端配置缓存')}
              </Button>
            </Flexbox>
          </AdminSection>

          <AdminSection
            title={t('admin.maintenance.memorySection', '记忆系统')}
            description={t(
              'admin.maintenance.memorySectionDescription',
              '选择记忆分析任务在单机、多实例或云函数环境中的执行方式。',
            )}
          >
            <Alert
              showIcon
              type="info"
              message={t(
                'admin.maintenance.memoryReason',
                '记忆分析会扫描用户聊天主题并调用模型提取长期记忆，任务可能较慢。单机 Node 部署建议使用“直接执行”；多实例或云函数部署可切换到 QStash 工作流。',
              )}
            />
            <Form.Item
              label={t('admin.maintenance.memoryTriggerMode', '记忆分析执行模式')}
              name="memoryUserMemoryTriggerMode"
              extra={t(
                'admin.maintenance.memoryTriggerHelp',
                '自动选择：检测到 QSTASH_TOKEN 时优先使用 QStash 工作流，否则直接执行。环境变量 MEMORY_USER_MEMORY_TRIGGER_MODE 可作为运维级覆盖。',
              )}
            >
              <Select disabled={isLoading || !data} options={memoryTriggerModeOptions} />
            </Form.Item>
            <Text type="secondary">
              QSTASH_TOKEN：
              {data?.sharedHealth?.qstashTokenConfigured ? '已配置，可使用工作流模式' : '未配置'}
              ；环境变量 MEMORY_USER_MEMORY_TRIGGER_MODE：
              {data?.sharedHealth?.memoryUserMemoryTriggerModeEnv || '未设置'}
            </Text>
          </AdminSection>

          <AdminFormActions label={t('admin.maintenance.actions', '系统维护配置操作')}>
            <Button
              disabled={isLoading || !data || running || refreshingCaches}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              {t('admin.maintenance.save', '保存系统维护设置')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>

      <Modal
        footer={null}
        open={!!runResult}
        title={t('admin.maintenance.runResult', '维护结果')}
        onCancel={() => setRunResult(null)}
      >
        <Descriptions
          column={1}
          size="small"
          items={[
            { children: runResult?.auditLogsDeleted ?? 0, label: '已删除审计日志' },
            { children: runResult?.auditCutoff ?? '-', label: '审计日志清理时间点' },
            { children: runResult?.pendingOrdersExpired ?? 0, label: '已过期待支付订单' },
            { children: runResult?.pendingOrdersCutoff ?? '-', label: '待支付订单过期时间点' },
            { children: runResult?.notificationsDeleted ?? 0, label: '已删除归档通知' },
            {
              children: runResult?.notificationRetentionCutoff ?? '-',
              label: '归档通知清理时间点',
            },
            { children: runResult?.subscriptionSnapshotsExpired ?? 0, label: '已过期订阅快照' },
            { children: runResult?.freeSnapshotsCreated ?? 0, label: '已补充免费套餐' },
            { children: runResult?.moduleAppUploadsExpired ?? 0, label: '已清理模块应用上传' },
            {
              children: runResult?.moduleAppUploadCleanupFailed ?? 0,
              label: '模块应用上传清理失败',
            },
          ]}
        />
      </Modal>
    </AdminPageShell>
  );
});

AdminSystemMaintenancePage.displayName = 'AdminSystemMaintenancePage';

export default AdminSystemMaintenancePage;
