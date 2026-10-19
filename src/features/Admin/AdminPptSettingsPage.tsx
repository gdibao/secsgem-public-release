'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, InputNumber, message, Switch } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

type FormValues = {
  allowPdfExport: boolean;
  allowPptxDownload: boolean;
  apiKey?: string;
  auditEnabled: boolean;
  baseUrl: string;
  clearApiKey?: boolean;
  creatorVersion: 'v1' | 'v2';
  dailyLimit?: number;
  enabled: boolean;
  lang: string;
  themeColor?: string;
  tokenTtlMinutes: number;
};

const AdminPptSettingsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('ppt'), () =>
    adminCommercialService.getSettingsSection('ppt'),
  );

  useEffect(() => {
    if (!data) return;

    form.setFieldsValue({
      allowPdfExport: data.allowPdfExport,
      allowPptxDownload: data.allowPptxDownload,
      apiKey: '',
      auditEnabled: data.auditEnabled,
      baseUrl: data.baseUrl,
      clearApiKey: false,
      creatorVersion: data.creatorVersion,
      dailyLimit: data.dailyLimit ?? undefined,
      enabled: data.enabled,
      lang: data.lang,
      themeColor: data.themeColor ?? undefined,
      tokenTtlMinutes: data.tokenTtlMinutes,
    });
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    try {
      const values = await form.validateFields();
      setSubmitting(true);

      await adminCommercialService.savePptSettings({
        allowPdfExport: values.allowPdfExport,
        allowPptxDownload: values.allowPptxDownload,
        apiKey: values.apiKey?.trim() || undefined,
        auditEnabled: values.auditEnabled,
        baseUrl: values.baseUrl,
        clearApiKey: values.clearApiKey,
        creatorVersion: values.creatorVersion,
        dailyLimit: values.dailyLimit && values.dailyLimit > 0 ? values.dailyLimit : null,
        enabled: values.enabled,
        lang: values.lang,
        themeColor: values.themeColor?.trim() || null,
        tokenTtlMinutes: values.tokenTtlMinutes,
      });

      form.setFieldValue('apiKey', '');
      form.setFieldValue('clearApiKey', false);
      message.success(t('admin.ppt.saveSuccess', 'PPT 创作设置已保存'));
    } catch {
      message.error(t('admin.ppt.saveFailed', '保存失败，请检查配置'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.ppt.title', 'PPT 创作设置')}
      width="medium"
      description={t(
        'admin.ppt.subtitle',
        '配置 Docmee AiPPT 服务、下载权限、Token 有效期与审计策略。套餐级权限在“套餐管理”中设置。',
      )}
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.ppt.secretTip',
          'Docmee API-Key 只保存在服务端；前端页面仅获取短期 UI Token，不会暴露密钥。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.ppt.loadFailed', '无法读取当前 PPT 创作配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}

      <Form
        disabled={isLoading || !data}
        form={form}
        layout="vertical"
        initialValues={{
          allowPdfExport: true,
          allowPptxDownload: true,
          auditEnabled: true,
          baseUrl: 'https://docmee.cn',
          clearApiKey: false,
          creatorVersion: 'v2',
          enabled: false,
          lang: 'zh',
          tokenTtlMinutes: 60,
        }}
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.ppt.connectionSection', '服务连接')}
            description={t(
              'admin.ppt.connectionSectionDescription',
              '配置 Docmee 服务地址、服务端密钥和短期 UI Token 有效期。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.ppt.enabled', '启用 PPT 创作')}
                name="enabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.clearApiKey', '清除已有 API-Key')}
                name="clearApiKey"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.apiKey', 'Docmee API-Key')}
                name="apiKey"
                extra={
                  data?.apiKeyConfigured
                    ? `${t('admin.ppt.currentKey', '当前已配置')}: ${data.apiKeyMasked}`
                    : t('admin.ppt.notConfigured', '尚未配置 API-Key')
                }
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={t('admin.ppt.apiKeyPlaceholder', '留空表示不更换已有 API-Key')}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.baseUrl', '服务地址')}
                name="baseUrl"
                rules={[{ required: true }]}
              >
                <Input placeholder="https://docmee.cn" />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.tokenTtl', 'Token 有效期（分钟）')}
                name="tokenTtlMinutes"
                rules={[{ required: true }]}
              >
                <InputNumber max={1440} min={1} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.ppt.defaultsSection', '创作默认值')}
            description={t(
              'admin.ppt.defaultsSectionDescription',
              '设置新建演示文稿时使用的语言、创建器版本、主题色与每日额度。',
            )}
          >
            <AdminFormGrid>
              <Form.Item label={t('admin.ppt.lang', '默认语言')} name="lang">
                <Select
                  disabled={isLoading || !data}
                  options={[
                    { label: '简体中文', value: 'zh' },
                    { label: 'English（英文）', value: 'en' },
                  ]}
                />
              </Form.Item>
              <Form.Item label={t('admin.ppt.creatorVersion', '创建器版本')} name="creatorVersion">
                <Select
                  disabled={isLoading || !data}
                  options={[
                    { label: '对话式 V2', value: 'v2' },
                    { label: '步骤式 V1', value: 'v1' },
                  ]}
                />
              </Form.Item>
              <Form.Item label={t('admin.ppt.themeColor', '主题色')} name="themeColor">
                <Input placeholder="#00A76F" />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.dailyLimit', '单用户每日生成上限')}
                name="dailyLimit"
                extra={t(
                  'admin.ppt.dailyLimitHint',
                  '留空或 0 表示不限制；套餐月额度仍会独立生效。',
                )}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.ppt.permissionsSection', '导出权限与审计')}
            description={t(
              'admin.ppt.permissionsSectionDescription',
              '控制用户可用的导出格式，并决定是否保留创作审计记录。',
            )}
          >
            <AdminFormGrid columns={3}>
              <Form.Item
                label={t('admin.ppt.allowPptxDownload', '允许下载 PPTX')}
                name="allowPptxDownload"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.allowPdfExport', '允许导出 PDF')}
                name="allowPdfExport"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.ppt.auditEnabled', '记录审计日志')}
                name="auditEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminFormActions label={t('admin.ppt.actions', 'PPT 创作配置操作')}>
            <Button
              disabled={isLoading || !data}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              {t('admin.ppt.save', '保存设置')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

AdminPptSettingsPage.displayName = 'AdminPptSettingsPage';

export default AdminPptSettingsPage;
