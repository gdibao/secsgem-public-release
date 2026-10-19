'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, message, Radio, Switch } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import {
  GLOBAL_MODEL_POLICY_DENIED_MESSAGE,
  GLOBAL_MODEL_POLICY_HELP_TEXT,
  MODEL_POLICY_MATRIX_PATH,
} from '@/features/Admin/adminModelPolicySettings';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

const SETTING_KEYS = {
  allowlist: 'model.policy.allowlist',
  applyToEmbeddings: 'model.policy.applyToEmbeddings',
  applyToGenerateObject: 'model.policy.applyToGenerateObject',
  blocklist: 'model.policy.blocklist',
  defaultModelFallback: 'model.policy.defaultModelFallback',
  deniedMessage: 'model.policy.deniedMessage',
  enabled: 'model.policy.enabled',
  mode: 'model.policy.mode',
} as const;

const LIST_SPLIT_REGEX = /[\r\n,;；，]+/;

type FormValues = {
  allowlistText: string;
  applyToEmbeddings: boolean;
  applyToGenerateObject: boolean;
  blocklistText: string;
  defaultModelFallback: string;
  deniedMessage: string;
  enabled: boolean;
  mode: 'allowlist' | 'blocklist';
};

const normalizeListText = (value: unknown) => {
  const values =
    typeof value === 'string'
      ? value
          .split(LIST_SPLIT_REGEX)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  return Array.from(new Set(values)).join('\n');
};

const AdminModelPolicyPage = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('model-policy'), () =>
    adminCommercialService.getSettingsSection('model-policy'),
  );

  const defaultModelOptions = useMemo(
    () =>
      (data?.sharedHealth?.enabledNewapiModels ?? []).map((model) => ({
        label: model.displayName || model.modelId,
        value: model.modelId,
      })),
    [data?.sharedHealth?.enabledNewapiModels],
  );

  useEffect(() => {
    const config = data?.modelPolicyConfig;
    if (!config) return;

    form.setFieldsValue({
      allowlistText: config.allowlistText || '',
      applyToEmbeddings: config.applyToEmbeddings,
      applyToGenerateObject: config.applyToGenerateObject,
      blocklistText: config.blocklistText || '',
      defaultModelFallback: config.defaultModelFallback || '',
      deniedMessage: config.deniedMessage,
      enabled: config.enabled,
      mode: config.mode,
    });
  }, [data, form]);

  const handleNormalizeAllowlist = () => {
    form.setFieldValue('allowlistText', normalizeListText(form.getFieldValue('allowlistText')));
  };

  const handleNormalizeBlocklist = () => {
    form.setFieldValue('blocklistText', normalizeListText(form.getFieldValue('blocklistText')));
  };

  const handleSave = async () => {
    if (!data) return;

    setSubmitting(true);

    try {
      const values = await form.validateFields();
      await adminCommercialService.setAppSettingsBatch({
        updates: [
          { key: SETTING_KEYS.enabled, value: values.enabled },
          { key: SETTING_KEYS.mode, value: values.mode },
          {
            key: SETTING_KEYS.allowlist,
            value: normalizeListText(values.allowlistText),
          },
          {
            key: SETTING_KEYS.blocklist,
            value: normalizeListText(values.blocklistText),
          },
          {
            key: SETTING_KEYS.deniedMessage,
            value: values.deniedMessage,
          },
          {
            key: SETTING_KEYS.applyToEmbeddings,
            value: values.applyToEmbeddings,
          },
          {
            key: SETTING_KEYS.applyToGenerateObject,
            value: values.applyToGenerateObject,
          },
          {
            key: SETTING_KEYS.defaultModelFallback,
            value: values.defaultModelFallback,
          },
        ],
      });

      message.success(t('admin.modelPolicy.saveSuccess', '全局模型策略已保存'));
    } catch {
      message.error(t('admin.modelPolicy.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.modelPolicy.title', '全局模型策略')}
      width="medium"
      description={t(
        'admin.modelPolicy.subtitle',
        '集中设置全局模型访问策略、适用范围和默认兜底模型。',
      )}
    >
      <Alert
        showIcon
        message={t('admin.modelPolicy.tip', GLOBAL_MODEL_POLICY_HELP_TEXT)}
        type="info"
        action={
          <Button size="small" onClick={() => navigate(MODEL_POLICY_MATRIX_PATH)}>
            打开矩阵
          </Button>
        }
      />
      {error ? (
        <AdminPageError
          description={t('admin.modelPolicy.loadFailed', '无法读取当前模型策略，请重试。')}
          onRetry={refresh}
        />
      ) : null}
      <Form
        disabled={isLoading || !data}
        form={form}
        layout="vertical"
        initialValues={{
          allowlistText: '',
          applyToEmbeddings: true,
          applyToGenerateObject: true,
          blocklistText: '',
          defaultModelFallback: '',
          deniedMessage: GLOBAL_MODEL_POLICY_DENIED_MESSAGE,
          enabled: false,
          mode: 'blocklist',
        }}
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.modelPolicy.statusSection', '策略状态')}
            description={t(
              'admin.modelPolicy.statusSectionDescription',
              '决定是否启用全局限制，以及列表采用允许还是禁用语义。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.modelPolicy.enabled', '启用全局模型策略')}
                name="enabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item label={t('admin.modelPolicy.mode', '策略模式')} name="mode">
                <Radio.Group
                  options={[
                    {
                      label: t('admin.modelPolicy.mode.blocklist', '禁用列表中的模型'),
                      value: 'blocklist',
                    },
                    {
                      label: t('admin.modelPolicy.mode.allowlist', '仅允许列表中的模型'),
                      value: 'allowlist',
                    },
                  ]}
                />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.modelPolicy.listsSection', '全局模型列表')}
            description={t(
              'admin.modelPolicy.listsSectionDescription',
              '支持每行、逗号或分号分隔，输入框失焦时会自动去重并规范化。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.modelPolicy.allowlist', '允许列表')}
                name="allowlistText"
                extra={t(
                  'admin.modelPolicy.allowlist.help',
                  '启用允许列表模式后，仅这些模型可以使用。每行一个条目。',
                )}
              >
                <Input.TextArea
                  placeholder={'openai:gpt-4o-mini\ndeepseek:deepseek-chat'}
                  rows={6}
                  onBlur={handleNormalizeAllowlist}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.modelPolicy.blocklist', '禁用列表')}
                name="blocklistText"
                extra={t(
                  'admin.modelPolicy.blocklist.help',
                  '启用禁用列表模式后，这些模型会被拒绝。每行一个条目。',
                )}
              >
                <Input.TextArea
                  placeholder={'openai:o1*\n*:old-*'}
                  rows={6}
                  onBlur={handleNormalizeBlocklist}
                />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.modelPolicy.scopeSection', '作用范围与兜底')}
            description={t(
              'admin.modelPolicy.scopeSectionDescription',
              '设置策略覆盖的调用类型、拒绝提示和未来自动切换使用的兜底模型。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.modelPolicy.applyToEmbeddings', '应用到向量模型')}
                name="applyToEmbeddings"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.modelPolicy.applyToGenerateObject', '应用到结构化输出')}
                name="applyToGenerateObject"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.modelPolicy.fallback', '默认兜底模型')}
                name="defaultModelFallback"
                extra={t(
                  'admin.modelPolicy.fallback.help',
                  '用于安全兜底展示和后续自动切换；当前运行时仍会直接拒绝不允许的模型。',
                )}
              >
                <Input list="admin-model-policy-fallback-options" placeholder="gpt-4o-mini" />
              </Form.Item>
            </AdminFormGrid>
            <datalist id="admin-model-policy-fallback-options">
              {defaultModelOptions.map((item) => (
                <option key={item.value} value={item.value} />
              ))}
            </datalist>
            <Form.Item
              label={t('admin.modelPolicy.deniedMessage', '拒绝提示')}
              name="deniedMessage"
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          </AdminSection>

          <AdminFormActions label={t('admin.modelPolicy.actions', '模型策略操作')}>
            <Button
              disabled={isLoading || !data}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              {t('admin.settings.save', '保存')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

AdminModelPolicyPage.displayName = 'AdminModelPolicyPage';

export default AdminModelPolicyPage;
