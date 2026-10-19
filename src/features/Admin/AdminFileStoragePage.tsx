'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, InputNumber, message, Switch } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { normalizeText, SETTING_KEYS } from '@/features/Admin/adminSettingsForm';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

type FileStorageFormValues = {
  storageS3AccessKeyId: string;
  storageS3Bucket: string;
  storageS3EnablePathStyle: boolean;
  storageS3Endpoint: string;
  storageS3FilePath: string;
  storageS3PreviewUrlExpireIn: number;
  storageS3PublicDomain: string;
  storageS3Region: string;
  storageS3SecretAccessKey: string;
  storageS3SetAcl: boolean;
};

const normalizeS3FilePath = (value: unknown) =>
  normalizeText(value)
    .replaceAll('\\', '/')
    .replaceAll(/^\/+|\/+$/g, '') || 'files';

const buildInitialValues = (data: any): FileStorageFormValues => ({
  storageS3AccessKeyId: data?.storageS3AccessKeyId ?? '',
  storageS3Bucket: data?.storageS3Bucket ?? '',
  storageS3EnablePathStyle: data?.storageS3EnablePathStyle ?? false,
  storageS3Endpoint: data?.storageS3Endpoint ?? '',
  storageS3FilePath: data?.storageS3FilePath ?? 'files',
  storageS3PreviewUrlExpireIn: data?.storageS3PreviewUrlExpireIn ?? 7200,
  storageS3PublicDomain: data?.storageS3PublicDomain ?? '',
  storageS3Region: data?.storageS3Region ?? '',
  storageS3SecretAccessKey: '',
  storageS3SetAcl: data?.storageS3SetAcl ?? false,
});

const normalizeValues = (values: FileStorageFormValues): FileStorageFormValues => ({
  storageS3AccessKeyId: normalizeText(values.storageS3AccessKeyId),
  storageS3Bucket: normalizeText(values.storageS3Bucket),
  storageS3EnablePathStyle: Boolean(values.storageS3EnablePathStyle),
  storageS3Endpoint: normalizeText(values.storageS3Endpoint),
  storageS3FilePath: normalizeS3FilePath(values.storageS3FilePath),
  storageS3PreviewUrlExpireIn:
    typeof values.storageS3PreviewUrlExpireIn === 'number'
      ? values.storageS3PreviewUrlExpireIn
      : 7200,
  storageS3PublicDomain: normalizeText(values.storageS3PublicDomain),
  storageS3Region: normalizeText(values.storageS3Region),
  storageS3SecretAccessKey: normalizeText(values.storageS3SecretAccessKey),
  storageS3SetAcl: Boolean(values.storageS3SetAcl),
});

const buildUpdates = (values: FileStorageFormValues, initial: FileStorageFormValues) => {
  const current = normalizeValues(values);
  const baseline = normalizeValues(initial);
  const updates: { key: string; value: unknown }[] = [];

  const fields: Array<keyof FileStorageFormValues> = [
    'storageS3AccessKeyId',
    'storageS3Endpoint',
    'storageS3FilePath',
    'storageS3Bucket',
    'storageS3Region',
    'storageS3PublicDomain',
    'storageS3EnablePathStyle',
    'storageS3SetAcl',
    'storageS3PreviewUrlExpireIn',
  ];

  const keyMap: Record<keyof FileStorageFormValues, string> = {
    storageS3AccessKeyId: SETTING_KEYS.storageS3AccessKeyId,
    storageS3Bucket: SETTING_KEYS.storageS3Bucket,
    storageS3EnablePathStyle: SETTING_KEYS.storageS3EnablePathStyle,
    storageS3Endpoint: SETTING_KEYS.storageS3Endpoint,
    storageS3FilePath: SETTING_KEYS.storageS3FilePath,
    storageS3PreviewUrlExpireIn: SETTING_KEYS.storageS3PreviewUrlExpireIn,
    storageS3PublicDomain: SETTING_KEYS.storageS3PublicDomain,
    storageS3Region: SETTING_KEYS.storageS3Region,
    storageS3SecretAccessKey: SETTING_KEYS.storageS3SecretAccessKey,
    storageS3SetAcl: SETTING_KEYS.storageS3SetAcl,
  };

  for (const field of fields) {
    if (current[field] !== baseline[field]) {
      updates.push({ key: keyMap[field], value: current[field] });
    }
  }

  if (current.storageS3SecretAccessKey) {
    updates.push({
      key: SETTING_KEYS.storageS3SecretAccessKey,
      value: current.storageS3SecretAccessKey,
    });
  }

  return updates;
};

const AdminFileStoragePage = memo(() => {
  const { t } = useTranslation('subscription');
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('file-storage'), () =>
    adminCommercialService.getSettingsSection('file-storage'),
  );
  const [form] = Form.useForm<FileStorageFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);

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
        message.info(t('admin.fileStorage.noChanges', '没有需要保存的变更'));
        return;
      }

      setSubmitting(true);
      await adminCommercialService.setAppSettingsBatch({ updates });
      form.setFieldValue('storageS3SecretAccessKey', '');
      message.success(t('admin.fileStorage.saveSuccess', '文件存储设置已保存'));
    } catch {
      message.error(t('admin.fileStorage.saveFailed', '保存失败，请检查 S3 配置'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    if (!data) return;

    setTesting(true);
    try {
      const result = await adminCommercialService.testS3Storage();
      const checkSummary = result.checks
        ? result.checks.corsPreflight?.skipped
          ? 'Bucket、内部上传、读取、删除通过；公共端点 CORS 需由浏览器验证'
          : 'Bucket、CORS、预签名上传、读取、删除均通过'
        : '连接正常';
      message.success(
        t(
          'admin.fileStorage.testSuccess',
          `S3 测试通过：${result.bucket}（${result.filePath}），${checkSummary}`,
        ),
      );
    } catch (error) {
      message.error(
        `${t('admin.fileStorage.testFailed', 'S3 连接失败')}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.fileStorage.title', '文件存储')}
      width="medium"
      description={t(
        'admin.fileStorage.subtitle',
        '统一配置用户上传文件、头像、图片生成、视频生成等内容的 S3 兼容对象存储。',
      )}
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.fileStorage.help',
          '后台配置优先于服务器环境变量；留空字段会继续使用环境变量兜底。修改后后续请求立即使用新配置，不需要重新构建。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.fileStorage.loadFailed', '无法读取当前文件存储配置，请重试。')}
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
            title={t('admin.fileStorage.connectionSection', '连接与凭据')}
            actions={
              <Button
                disabled={isLoading || !data || submitting}
                loading={testing}
                onClick={handleTest}
              >
                {t('admin.fileStorage.test', '测试 S3 连接')}
              </Button>
            }
            description={t(
              'admin.fileStorage.testHelp',
              '填写访问凭据与服务地址。连接测试仅校验当前已保存配置，不会写入文件。',
            )}
          >
            <AdminFormGrid>
              <Form.Item label="Access Key ID" name="storageS3AccessKeyId">
                <Input placeholder="S3_ACCESS_KEY_ID" />
              </Form.Item>
              <Form.Item
                label="Secret Access Key"
                name="storageS3SecretAccessKey"
                extra={
                  data?.storageS3SecretAccessKeyConfigured
                    ? `${t('admin.fileStorage.current', '当前值')}: ${
                        data.storageS3SecretAccessKeyMasked || '已配置'
                      }`
                    : t('admin.fileStorage.notSet', '未配置')
                }
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={t('admin.fileStorage.leaveBlank', '留空则保持当前值')}
                />
              </Form.Item>
              <Form.Item
                label="Endpoint 地址"
                name="storageS3Endpoint"
                extra={t(
                  'admin.fileStorage.endpointHelp',
                  '填写 S3 兼容服务的 API 地址，例如 AWS S3、阿里云 OSS 或 MinIO/RustFS。',
                )}
              >
                <Input placeholder="https://s3.example.com" />
              </Form.Item>
              <Form.Item label="Bucket 名称" name="storageS3Bucket">
                <Input placeholder="lobe" />
              </Form.Item>
              <Form.Item
                label="Region 区域"
                name="storageS3Region"
                extra={t(
                  'admin.fileStorage.regionHelp',
                  'AWS S3 通常需要区域；MinIO/RustFS 可以留空或使用 us-east-1。',
                )}
              >
                <Input placeholder="us-east-1" />
              </Form.Item>
              <Form.Item
                label="启用 Path-style 路径"
                name="storageS3EnablePathStyle"
                valuePropName="checked"
                extra={t(
                  'admin.fileStorage.pathStyleHelp',
                  'MinIO、RustFS 等自建 S3 通常需要开启；AWS/R2/OSS 多数场景可以关闭。',
                )}
              >
                <Switch />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.fileStorage.objectAddressSection', '对象地址')}
            description={t(
              'admin.fileStorage.objectAddressDescription',
              '配置对象 Key 前缀和面向客户端的公开访问地址。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label="上传目录前缀"
                name="storageS3FilePath"
                extra={t(
                  'admin.fileStorage.filePathHelp',
                  '用于生成对象 Key，例如 files/490000/mock.png。不要以 / 开头。',
                )}
              >
                <Input placeholder="files" />
              </Form.Item>
              <Form.Item
                label="公开访问域名 / CDN"
                name="storageS3PublicDomain"
                extra={t(
                  'admin.fileStorage.publicDomainHelp',
                  '开启公开读 ACL 时用于拼接文件 URL；否则系统会返回短期预签名 URL。',
                )}
              >
                <Input placeholder="https://cdn.example.com" />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.fileStorage.accessPolicySection', '访问策略')}
            description={t(
              'admin.fileStorage.accessPolicyDescription',
              '控制对象公开读策略与私有对象预签名地址的有效时间。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label="上传时设置 public-read ACL"
                name="storageS3SetAcl"
                valuePropName="checked"
                extra={t(
                  'admin.fileStorage.setAclHelp',
                  '仅在对象存储允许 ACL 且需要直接公开访问时开启。',
                )}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="预览 URL 有效期（秒）"
                name="storageS3PreviewUrlExpireIn"
                extra={t(
                  'admin.fileStorage.previewExpireHelp',
                  '关闭公开读或未配置 CDN 时生效，建议 1800-7200 秒。',
                )}
              >
                <InputNumber max={604_800} min={60} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminFormActions label={t('admin.fileStorage.actions', '文件存储配置操作')}>
            <Button
              disabled={isLoading || !data || testing}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              {t('admin.fileStorage.save', '保存文件存储设置')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

AdminFileStoragePage.displayName = 'AdminFileStoragePage';

export default AdminFileStoragePage;
