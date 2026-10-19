'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
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

const SETTING_KEYS = {
  initialCredits: 'onboarding.initialCredits',
  initialCreditsEnabled: 'onboarding.initialCredits.enabled',
  referralRewardCredits: 'referral.rewardCredits',
  signupDisabledMessage: 'auth.signup.disabledMessage',
  signupEnabled: 'auth.signup.enabled',
  signupPhoneEnabled: 'auth.signup.phoneEnabled',
  uploadMaxActualSizeMb: 'upload.maxActualSizeMb',
  uploadMaxInputSizeMb: 'upload.maxInputSizeMb',
} as const;

type FormValues = {
  initialCredits: number;
  initialCreditsEnabled: boolean;
  referralRewardCredits: number;
  signupDisabledMessage: string;
  signupEnabled: boolean;
  signupPhoneEnabled: boolean;
  uploadMaxActualSizeMb: number;
  uploadMaxInputSizeMb: number;
};

const AdminGrowthPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('growth'), () =>
    adminCommercialService.getSettingsSection('growth'),
  );

  useEffect(() => {
    if (!data?.growthConfig) return;
    form.setFieldsValue({
      initialCredits: data.growthConfig.initialCredits.amount,
      initialCreditsEnabled: data.growthConfig.initialCredits.enabled,
      referralRewardCredits: data.referralRewardCredits ?? 0,
      signupDisabledMessage: data.growthConfig.signup.disabledMessage,
      signupEnabled: data.growthConfig.signup.enabled,
      signupPhoneEnabled: data.growthConfig.signup.phoneEnabled,
      uploadMaxActualSizeMb: data.growthConfig.upload.maxActualSizeMb,
      uploadMaxInputSizeMb: data.growthConfig.upload.maxInputSizeMb,
    });
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    setSubmitting(true);
    try {
      const values = await form.validateFields();
      await adminCommercialService.setAppSettingsBatch({
        updates: [
          {
            key: SETTING_KEYS.signupEnabled,
            value: values.signupEnabled,
          },
          {
            key: SETTING_KEYS.signupDisabledMessage,
            value: values.signupDisabledMessage,
          },
          {
            key: SETTING_KEYS.signupPhoneEnabled,
            value: values.signupPhoneEnabled,
          },
          {
            key: SETTING_KEYS.initialCreditsEnabled,
            value: values.initialCreditsEnabled,
          },
          {
            key: SETTING_KEYS.initialCredits,
            value: values.initialCredits,
          },
          {
            key: SETTING_KEYS.referralRewardCredits,
            value: values.referralRewardCredits,
          },
          {
            key: SETTING_KEYS.uploadMaxInputSizeMb,
            value: values.uploadMaxInputSizeMb,
          },
          {
            key: SETTING_KEYS.uploadMaxActualSizeMb,
            value: values.uploadMaxActualSizeMb,
          },
        ],
      });
      message.success(t('admin.growth.saveSuccess', '增长配置已保存'));
    } catch {
      message.error(t('admin.growth.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.growth.title', '增长与注册')}
      width="medium"
      description={t(
        'admin.growth.subtitle',
        '管理用户注册、新账号权益、邀请奖励与全站文件上传限制。',
      )}
    >
      <Alert
        showIcon
        message={t('admin.growth.tip', '这些配置会影响注册、新用户初始化和文件上传校验。')}
        type="info"
      />
      {error ? (
        <AdminPageError
          description={t('admin.growth.loadFailed', '无法读取当前增长配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}
      <Form
        disabled={isLoading || !data}
        form={form}
        layout="vertical"
        initialValues={{
          initialCredits: 0,
          initialCreditsEnabled: false,
          referralRewardCredits: 0,
          signupDisabledMessage: '注册暂时关闭。',
          signupEnabled: true,
          signupPhoneEnabled: false,
          uploadMaxActualSizeMb: 0,
          uploadMaxInputSizeMb: 0,
        }}
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.growth.signupSection', '注册')}
            description={t(
              'admin.growth.signupSectionDescription',
              '控制注册入口、关闭时的用户提示以及手机号资料采集。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.growth.signupEnabled', '允许新用户注册')}
                name="signupEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.growth.signupPhoneEnabled', '注册时填写手机号')}
                name="signupPhoneEnabled"
                valuePropName="checked"
                extra={t(
                  'admin.growth.signupPhoneEnabled.help',
                  '开启后，注册表单会显示手机号输入项，并保存到后台用户资料。',
                )}
              >
                <Switch />
              </Form.Item>
            </AdminFormGrid>
            <Form.Item
              label={t('admin.growth.signupDisabledMessage', '注册关闭提示')}
              name="signupDisabledMessage"
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          </AdminSection>

          <AdminSection
            title={t('admin.growth.onboardingSection', '新用户初始化')}
            description={t(
              'admin.growth.onboardingSectionDescription',
              '设置新账号创建时一次性发放的初始权益。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.growth.initialCreditsEnabled', '赠送初始积分')}
                name="initialCreditsEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.growth.initialCredits', '初始积分')}
                name="initialCredits"
                extra={t(
                  'admin.growth.initialCredits.help',
                  '新账号创建时仅赠送一次，使用系统内部积分单位。',
                )}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.growth.referralSection', '邀请与推荐')}
            description={t(
              'admin.growth.referralSectionDescription',
              '设置邀请新用户完成注册后发放的奖励。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.growth.referralReward', '推荐奖励积分')}
                name="referralRewardCredits"
                extra={t(
                  'admin.growth.referralReward.help',
                  '用户邀请新用户完成注册后发放的奖励积分，使用系统内部积分单位。',
                )}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.growth.uploadSection', '上传限制')}
            description={t(
              'admin.growth.uploadSectionDescription',
              '同时限制客户端声明大小和服务端实际接收大小，0 表示不限制。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                extra={t('admin.growth.upload.zeroUnlimited', '0 表示不限制。')}
                label={t('admin.growth.uploadMaxInputSizeMb', '最大声明文件大小（MB）')}
                name="uploadMaxInputSizeMb"
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                extra={t('admin.growth.upload.zeroUnlimited', '0 表示不限制。')}
                label={t('admin.growth.uploadMaxActualSizeMb', '最大实际文件大小（MB）')}
                name="uploadMaxActualSizeMb"
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminFormActions label={t('admin.growth.actions', '增长配置操作')}>
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

AdminGrowthPage.displayName = 'AdminGrowthPage';

export default AdminGrowthPage;
