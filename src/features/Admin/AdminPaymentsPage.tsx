'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, message, Skeleton, Tag, Typography } from 'antd';
import { Save } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Card } from '@/components/antd-compat/Card';
import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { AdminFormActions, AdminPageError, AdminPageShell } from './layout';
import ModulePaymentsPage from './moduleApps/finance/payments/ModulePaymentsPage';
import CreditSettlementFailuresPage from './payments/CreditSettlementFailuresPage';
import SubscriptionPaymentsPage from './payments/SubscriptionPaymentsPage';
import TopUpPaymentsPage from './payments/TopUpPaymentsPage';
import { useUnsavedChangesGuard } from './shared/useUnsavedChangesGuard';

const { Text } = Typography;

type PaymentFormValues = {
  alipayAppCertSn: string;
  alipayAppId: string;
  alipayCertMode: 'certificate' | 'public_key';
  alipayCertificate: string;
  alipayEnabled: boolean;
  alipayGateway: string;
  alipayMerchantPrivateKey: string;
  alipayMode: 'production' | 'sandbox';
  alipayPublicKey: string;
  alipayRootCertSn: string;
  alipaySellerId: string;
  defaultProvider: 'alipay' | 'wechat_pay' | 'zpay';
  enabled: boolean;
  moduleAppEnabled: boolean;
  publicBaseUrl: string;
  subscriptionEnabled: boolean;
  topUpEnabled: boolean;
  wechatApiBaseUrl: string;
  wechatApiV3Key: string;
  wechatAppId: string;
  wechatEnabled: boolean;
  wechatMchId: string;
  wechatMerchantPrivateKey: string;
  wechatMerchantSerialNo: string;
  wechatPlatformCertificate: string;
  wechatPlatformCertificateSerialNo: string;
  zpayAlipayEnabled: boolean;
  zpayApiBaseUrl: string;
  zpayEnabled: boolean;
  zpayMerchantId: string;
  zpayMerchantKey: string;
  zpayWechatEnabled: boolean;
};

type PaymentSettingsData = {
  paymentConfig?: {
    alipay?: {
      appCertSn?: string;
      appId?: string;
      certMode?: PaymentFormValues['alipayCertMode'];
      certificateConfigured?: boolean;
      certificateMasked?: null | string;
      configured?: boolean;
      enabled?: boolean;
      gateway?: string;
      merchantPrivateKeyConfigured?: boolean;
      merchantPrivateKeyMasked?: null | string;
      mode?: PaymentFormValues['alipayMode'];
      publicKeyConfigured?: boolean;
      publicKeyMasked?: null | string;
      rootCertSn?: string;
      sellerId?: string;
    };
    defaultProvider?: PaymentFormValues['defaultProvider'];
    enabled?: boolean;
    moduleAppEnabled?: boolean;
    publicBaseUrl?: string;
    source?: {
      backendManaged?: boolean;
      legacyEnvironmentKeys?: string[];
    };
    subscriptionEnabled?: boolean;
    topUpEnabled?: boolean;
    wechat?: {
      apiBaseUrl?: string;
      apiV3KeyConfigured?: boolean;
      apiV3KeyMasked?: null | string;
      appId?: string;
      configured?: boolean;
      enabled?: boolean;
      mchId?: string;
      merchantPrivateKeyConfigured?: boolean;
      merchantPrivateKeyMasked?: null | string;
      merchantSerialNo?: string;
      platformCertificateConfigured?: boolean;
      platformCertificateMasked?: null | string;
      platformCertificateSerialNo?: string;
    };
    zpay?: {
      alipayEnabled?: boolean;
      apiBaseUrl?: string;
      configured?: boolean;
      enabled?: boolean;
      merchantId?: string;
      merchantKeyConfigured?: boolean;
      merchantKeyMasked?: null | string;
      wechatEnabled?: boolean;
    };
  };
  paymentGatewayStatus?: {
    configured: boolean;
    enabled: boolean;
    methods: string[];
  };
};

const SECRET_FIELDS = [
  'alipayCertificate',
  'alipayMerchantPrivateKey',
  'alipayPublicKey',
  'wechatApiV3Key',
  'wechatMerchantPrivateKey',
  'wechatPlatformCertificate',
  'zpayMerchantKey',
] as const satisfies readonly (keyof PaymentFormValues)[];

const buildInitialValues = (data?: PaymentSettingsData): PaymentFormValues => {
  const config = data?.paymentConfig;
  return {
    alipayAppCertSn: config?.alipay?.appCertSn ?? '',
    alipayAppId: config?.alipay?.appId ?? '',
    alipayCertMode: config?.alipay?.certMode ?? 'public_key',
    alipayCertificate: '',
    alipayEnabled: config?.alipay?.enabled ?? false,
    alipayGateway: config?.alipay?.gateway ?? '',
    alipayMerchantPrivateKey: '',
    alipayMode: config?.alipay?.mode ?? 'sandbox',
    alipayPublicKey: '',
    alipayRootCertSn: config?.alipay?.rootCertSn ?? '',
    alipaySellerId: config?.alipay?.sellerId ?? '',
    defaultProvider: config?.defaultProvider ?? 'alipay',
    enabled: config?.enabled ?? false,
    moduleAppEnabled: config?.moduleAppEnabled ?? false,
    publicBaseUrl: config?.publicBaseUrl ?? '',
    subscriptionEnabled: config?.subscriptionEnabled ?? false,
    topUpEnabled: config?.topUpEnabled ?? false,
    wechatApiBaseUrl: config?.wechat?.apiBaseUrl ?? 'https://api.mch.weixin.qq.com',
    wechatApiV3Key: '',
    wechatAppId: config?.wechat?.appId ?? '',
    wechatEnabled: config?.wechat?.enabled ?? false,
    wechatMchId: config?.wechat?.mchId ?? '',
    wechatMerchantPrivateKey: '',
    wechatMerchantSerialNo: config?.wechat?.merchantSerialNo ?? '',
    wechatPlatformCertificate: '',
    wechatPlatformCertificateSerialNo: config?.wechat?.platformCertificateSerialNo ?? '',
    zpayAlipayEnabled: config?.zpay?.alipayEnabled ?? true,
    zpayApiBaseUrl: config?.zpay?.apiBaseUrl ?? 'https://zpayz.cn',
    zpayEnabled: config?.zpay?.enabled ?? false,
    zpayMerchantId: config?.zpay?.merchantId ?? '',
    zpayMerchantKey: '',
    zpayWechatEnabled: config?.zpay?.wechatEnabled ?? true,
  };
};

const FIELD_KEYS: Record<keyof PaymentFormValues, string> = {
  alipayAppCertSn: APP_SETTING_KEYS.paymentAlipayAppCertSn,
  alipayAppId: APP_SETTING_KEYS.paymentAlipayAppId,
  alipayCertMode: APP_SETTING_KEYS.paymentAlipayCertMode,
  alipayCertificate: APP_SETTING_KEYS.paymentAlipayCertificate,
  alipayEnabled: APP_SETTING_KEYS.paymentAlipayEnabled,
  alipayGateway: APP_SETTING_KEYS.paymentAlipayGateway,
  alipayMerchantPrivateKey: APP_SETTING_KEYS.paymentAlipayMerchantPrivateKey,
  alipayMode: APP_SETTING_KEYS.paymentAlipayMode,
  alipayPublicKey: APP_SETTING_KEYS.paymentAlipayPublicKey,
  alipayRootCertSn: APP_SETTING_KEYS.paymentAlipayRootCertSn,
  alipaySellerId: APP_SETTING_KEYS.paymentAlipaySellerId,
  defaultProvider: APP_SETTING_KEYS.paymentDefaultProvider,
  enabled: APP_SETTING_KEYS.paymentEnabled,
  moduleAppEnabled: APP_SETTING_KEYS.paymentModuleAppEnabled,
  publicBaseUrl: APP_SETTING_KEYS.paymentPublicBaseUrl,
  subscriptionEnabled: APP_SETTING_KEYS.paymentSubscriptionEnabled,
  topUpEnabled: APP_SETTING_KEYS.paymentTopUpEnabled,
  wechatApiBaseUrl: APP_SETTING_KEYS.paymentWechatApiBaseUrl,
  wechatApiV3Key: APP_SETTING_KEYS.paymentWechatApiV3Key,
  wechatAppId: APP_SETTING_KEYS.paymentWechatAppId,
  wechatEnabled: APP_SETTING_KEYS.paymentWechatEnabled,
  wechatMchId: APP_SETTING_KEYS.paymentWechatMchId,
  wechatMerchantPrivateKey: APP_SETTING_KEYS.paymentWechatMerchantPrivateKey,
  wechatMerchantSerialNo: APP_SETTING_KEYS.paymentWechatMerchantSerialNo,
  wechatPlatformCertificate: APP_SETTING_KEYS.paymentWechatPlatformCertificate,
  wechatPlatformCertificateSerialNo: APP_SETTING_KEYS.paymentWechatPlatformCertificateSerialNo,
  zpayAlipayEnabled: APP_SETTING_KEYS.paymentZpayAlipayEnabled,
  zpayApiBaseUrl: APP_SETTING_KEYS.paymentZpayApiBaseUrl,
  zpayEnabled: APP_SETTING_KEYS.paymentZpayEnabled,
  zpayMerchantId: APP_SETTING_KEYS.paymentZpayMerchantId,
  zpayMerchantKey: APP_SETTING_KEYS.paymentZpayMerchantKey,
  zpayWechatEnabled: APP_SETTING_KEYS.paymentZpayWechatEnabled,
};

const SecretHint = ({ configured, masked }: { configured?: boolean; masked?: null | string }) => {
  const { t } = useTranslation('subscription');
  return (
    <Text type="secondary">
      {configured
        ? t('admin.payments.secretConfigured', {
            defaultValue: 'Configured as {{masked}}. Leave blank to keep it unchanged.',
            masked: masked ?? '****',
          })
        : t('admin.payments.secretMissing', 'Not configured')}
    </Text>
  );
};

const PaymentChannelSettings = ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
  const { t } = useTranslation('subscription');
  const settings = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('payments'), () =>
    adminCommercialService.getSettingsSection('payments'),
  );
  const [form] = Form.useForm<PaymentFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const data = settings.data as PaymentSettingsData | undefined;
  const initialValues = useMemo(() => buildInitialValues(data), [data]);
  const certMode = Form.useWatch('alipayCertMode', form) ?? initialValues.alipayCertMode;

  useEffect(() => {
    if (data) {
      form.setFieldsValue(buildInitialValues(data));
      onDirtyChange(false);
    }
  }, [data, form, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const save = async () => {
    if (!data) return;
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const secretFields = new Set<string>(SECRET_FIELDS);
      const updates = Object.entries(values)
        .filter(([field, value]) => !secretFields.has(field) || String(value ?? '').trim())
        .map(([field, value]) => ({
          key: FIELD_KEYS[field as keyof PaymentFormValues],
          value,
        }));
      await adminCommercialService.setAppSettingsBatch({ updates });
      await mutate(ADMIN_SETTINGS_SECTION_SWR_KEY('payments'));
      onDirtyChange(false);
      message.success(t('admin.payments.saveSuccess', 'Payment settings saved'));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t('admin.payments.saveFailed', 'Save failed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const config = data?.paymentConfig;
  const status = data?.paymentGatewayStatus;
  const legacyEnvironmentKeys = config?.source?.legacyEnvironmentKeys ?? [];
  const formDisabled = settings.isLoading || Boolean(settings.error) || submitting || !data;
  const statusMessage = settings.error
    ? t('admin.payments.loadFailed', 'Unable to load payment settings')
    : !status
      ? t('admin.payments.loading', 'Loading payment status')
      : !status.enabled
        ? t('admin.payments.statusDisabled', 'Unified payments are disabled')
        : !status.configured
          ? t('admin.payments.statusIncomplete', 'No enabled payment method is fully configured')
          : t('admin.payments.statusReady', {
              count: status.methods.length,
              defaultValue: '{{count}} payment methods are available',
            });
  const urlRule = {
    validator: async (_: unknown, value?: string) => {
      if (!value) return;
      try {
        const url = new URL(value);
        const localHttp =
          url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
        if (!url.username && !url.password && (url.protocol === 'https:' || localHttp)) return;
      } catch {
        // The validation error below is shared by malformed and unsafe URLs.
      }
      throw new Error(t('admin.payments.urlInvalid', 'Enter a valid HTTPS URL'));
    },
  };

  if (settings.isLoading && !settings.data) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <Flexbox gap={16} style={{ maxWidth: 980 }}>
      {settings.error ? (
        <AdminPageError description={statusMessage} onRetry={settings.mutate} />
      ) : (
        <Alert
          showIcon
          message={statusMessage}
          type={status?.enabled && status?.configured ? 'success' : 'warning'}
        />
      )}
      {legacyEnvironmentKeys.length > 0 ? (
        <Alert
          showIcon
          type="warning"
          description={
            <Flexbox gap={8}>
              <span>
                {t('admin.payments.legacyEnvironment.description', {
                  count: legacyEnvironmentKeys.length,
                  defaultValue:
                    '{{count}} legacy environment variables are still available as payment configuration fallbacks. Re-enter secret values on this page and save equivalent backend settings before removing them.',
                })}
              </span>
              <Flexbox horizontal gap={6} wrap="wrap">
                {legacyEnvironmentKeys.map((key) => (
                  <Tag key={key}>{key}</Tag>
                ))}
              </Flexbox>
            </Flexbox>
          }
          message={t(
            'admin.payments.legacyEnvironment.title',
            'Payment configuration migration required',
          )}
        />
      ) : null}
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.payments.currencyNotice',
          'Online payments support CNY only. USD packages are neither converted nor offered at checkout.',
        )}
      />

      <Form
        disabled={formDisabled}
        form={form}
        layout="vertical"
        onValuesChange={() => onDirtyChange(true)}
      >
        <Flexbox gap={16}>
          <Card title={t('admin.payments.general', 'General')}>
            <Flexbox gap={12}>
              <Flexbox horizontal gap={24} wrap="wrap">
                <Form.Item
                  label={t('admin.payments.enabled', 'Enable unified payments')}
                  name="enabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.payments.moduleAppEnabled', 'Module purchases')}
                  name="moduleAppEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.payments.subscriptionEnabled', 'Plan subscriptions')}
                  name="subscriptionEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.payments.topUpEnabled', 'Credit top-ups')}
                  name="topUpEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Flexbox>
              <Form.Item
                label={t('admin.payments.defaultProvider', 'Default provider')}
                name="defaultProvider"
              >
                <Select
                  options={[
                    { label: t('admin.payments.provider.alipay', 'Alipay'), value: 'alipay' },
                    {
                      label: t('admin.payments.provider.wechat', 'WeChat Pay'),
                      value: 'wechat_pay',
                    },
                    { label: 'Z-Pay', value: 'zpay' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.payments.publicBaseUrl', 'Public origin')}
                name="publicBaseUrl"
                rules={[urlRule]}
                extra={t(
                  'admin.payments.publicBaseUrlHelp',
                  'Used to generate server callback URLs. Production requires a public HTTPS origin.',
                )}
              >
                <Input placeholder="https://chat.example.com" />
              </Form.Item>
            </Flexbox>
          </Card>

          <Tabs
            items={[
              {
                children: (
                  <Card>
                    <Flexbox gap={12}>
                      <Flexbox horizontal align="center" gap={8}>
                        <Form.Item noStyle name="alipayEnabled" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Text strong>
                          {t('admin.payments.alipay.enabled', 'Enable Alipay website payments')}
                        </Text>
                        {config?.alipay?.configured && (
                          <Tag color="green">{t('admin.payments.configured', 'Configured')}</Tag>
                        )}
                      </Flexbox>
                      <Form.Item
                        label={t('admin.payments.environment', 'Environment')}
                        name="alipayMode"
                      >
                        <Select
                          options={[
                            { label: t('admin.payments.sandbox', 'Sandbox'), value: 'sandbox' },
                            {
                              label: t('admin.payments.production', 'Production'),
                              value: 'production',
                            },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label={t('admin.payments.appId', 'App ID')} name="alipayAppId">
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.sellerId', 'Seller ID')}
                        name="alipaySellerId"
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.alipay.gateway', 'Alipay gateway')}
                        name="alipayGateway"
                        rules={[urlRule]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.alipay.certMode', 'Verification mode')}
                        name="alipayCertMode"
                      >
                        <Select
                          options={[
                            {
                              label: t('admin.payments.alipay.publicKeyMode', 'Alipay public key'),
                              value: 'public_key',
                            },
                            {
                              label: t('admin.payments.alipay.certificateMode', 'Certificate'),
                              value: 'certificate',
                            },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.alipay.privateKey', 'Application private key')}
                        name="alipayMerchantPrivateKey"
                        extra={
                          <SecretHint
                            configured={config?.alipay?.merchantPrivateKeyConfigured}
                            masked={config?.alipay?.merchantPrivateKeyMasked}
                          />
                        }
                      >
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                      </Form.Item>
                      {certMode === 'certificate' ? (
                        <>
                          <Form.Item
                            name="alipayCertificate"
                            extra={
                              <SecretHint
                                configured={config?.alipay?.certificateConfigured}
                                masked={config?.alipay?.certificateMasked}
                              />
                            }
                            label={t(
                              'admin.payments.alipay.certificate',
                              'Alipay public-key certificate',
                            )}
                          >
                            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                          </Form.Item>
                          <Form.Item
                            name="alipayAppCertSn"
                            label={t(
                              'admin.payments.alipay.appCertSn',
                              'Application certificate serial number',
                            )}
                          >
                            <Input />
                          </Form.Item>
                          <Form.Item
                            name="alipayRootCertSn"
                            label={t(
                              'admin.payments.alipay.rootCertSn',
                              'Alipay root certificate serial number',
                            )}
                          >
                            <Input />
                          </Form.Item>
                        </>
                      ) : (
                        <Form.Item
                          label={t('admin.payments.alipay.publicKey', 'Alipay public key')}
                          name="alipayPublicKey"
                          extra={
                            <SecretHint
                              configured={config?.alipay?.publicKeyConfigured}
                              masked={config?.alipay?.publicKeyMasked}
                            />
                          }
                        >
                          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                        </Form.Item>
                      )}
                    </Flexbox>
                  </Card>
                ),
                key: 'alipay',
                label: t('admin.payments.provider.alipay', 'Alipay'),
              },
              {
                children: (
                  <Card>
                    <Flexbox gap={12}>
                      <Flexbox horizontal align="center" gap={8}>
                        <Form.Item noStyle name="wechatEnabled" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Text strong>
                          {t('admin.payments.wechat.enabled', 'Enable WeChat Native Pay')}
                        </Text>
                        {config?.wechat?.configured && (
                          <Tag color="green">{t('admin.payments.configured', 'Configured')}</Tag>
                        )}
                      </Flexbox>
                      <Form.Item label={t('admin.payments.appId', 'App ID')} name="wechatAppId">
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.wechat.mchId', 'Merchant ID')}
                        name="wechatMchId"
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name="wechatMerchantSerialNo"
                        label={t(
                          'admin.payments.wechat.serialNo',
                          'Merchant certificate serial number',
                        )}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.apiBaseUrl', 'API base URL')}
                        name="wechatApiBaseUrl"
                        rules={[urlRule]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.wechat.privateKey', 'Merchant API private key')}
                        name="wechatMerchantPrivateKey"
                        extra={
                          <SecretHint
                            configured={config?.wechat?.merchantPrivateKeyConfigured}
                            masked={config?.wechat?.merchantPrivateKeyMasked}
                          />
                        }
                      >
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.wechat.apiV3Key', 'API v3 key (32 bytes)')}
                        name="wechatApiV3Key"
                        extra={
                          <SecretHint
                            configured={config?.wechat?.apiV3KeyConfigured}
                            masked={config?.wechat?.apiV3KeyMasked}
                          />
                        }
                      >
                        <Input.Password />
                      </Form.Item>
                      <Form.Item
                        name="wechatPlatformCertificate"
                        extra={
                          <SecretHint
                            configured={config?.wechat?.platformCertificateConfigured}
                            masked={config?.wechat?.platformCertificateMasked}
                          />
                        }
                        label={t(
                          'admin.payments.wechat.platformCertificate',
                          'WeChat Pay platform certificate',
                        )}
                      >
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                      </Form.Item>
                      <Form.Item
                        name="wechatPlatformCertificateSerialNo"
                        label={t(
                          'admin.payments.wechat.platformCertificateSerialNo',
                          'WeChat Pay platform certificate serial number',
                        )}
                      >
                        <Input />
                      </Form.Item>
                    </Flexbox>
                  </Card>
                ),
                key: 'wechat',
                label: t('admin.payments.provider.wechat', 'WeChat Pay'),
              },
              {
                children: (
                  <Card>
                    <Flexbox gap={12}>
                      <Flexbox horizontal align="center" gap={8}>
                        <Form.Item noStyle name="zpayEnabled" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Text strong>{t('admin.payments.zpay.enabled', 'Enable Z-Pay')}</Text>
                        {config?.zpay?.configured && (
                          <Tag color="green">{t('admin.payments.configured', 'Configured')}</Tag>
                        )}
                      </Flexbox>
                      <Form.Item
                        label={t('admin.payments.apiBaseUrl', 'API base URL')}
                        name="zpayApiBaseUrl"
                        rules={[urlRule]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.zpay.merchantId', 'Merchant ID (pid)')}
                        name="zpayMerchantId"
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        label={t('admin.payments.zpay.merchantKey', 'Merchant key')}
                        name="zpayMerchantKey"
                        extra={
                          <SecretHint
                            configured={config?.zpay?.merchantKeyConfigured}
                            masked={config?.zpay?.merchantKeyMasked}
                          />
                        }
                      >
                        <Input.Password />
                      </Form.Item>
                      <Flexbox horizontal gap={24}>
                        <Form.Item
                          label={t('admin.payments.zpay.alipay', 'Alipay sub-channel')}
                          name="zpayAlipayEnabled"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>
                        <Form.Item
                          label={t('admin.payments.zpay.wechat', 'WeChat sub-channel')}
                          name="zpayWechatEnabled"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>
                      </Flexbox>
                    </Flexbox>
                  </Card>
                ),
                key: 'zpay',
                label: 'Z-Pay',
              },
            ]}
          />
          <AdminFormActions label={t('admin.payments.actions', '支付渠道配置操作')}>
            <Button
              disabled={formDisabled}
              icon={<Icon icon={Save} size={16} />}
              loading={submitting}
              type="primary"
              onClick={() => void save()}
            >
              {t('admin.payments.save', 'Save payment settings')}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </Flexbox>
  );
};

type PaymentCenterTab = 'channels' | 'moduleApps' | 'settlements' | 'subscriptions' | 'topups';

const PAYMENT_CENTER_TABS = new Set<PaymentCenterTab>([
  'channels',
  'subscriptions',
  'topups',
  'moduleApps',
  'settlements',
]);

const AdminPaymentsPage = () => {
  const { t } = useTranslation('subscription');
  const [searchParams, setSearchParams] = useSearchParams();
  const [channelDirty, setChannelDirty] = useState(false);
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canViewChannels = hasAdminCapability(role, ADMIN_CAPABILITIES.systemRead);
  const canViewFinance = hasAdminCapability(role, ADMIN_CAPABILITIES.financeRead);
  const requestedTab = searchParams.get('tab') as PaymentCenterTab | null;
  const allowedTabs = new Set<PaymentCenterTab>([
    ...(canViewChannels ? (['channels'] as const) : []),
    ...(canViewFinance ? (['subscriptions', 'topups', 'moduleApps', 'settlements'] as const) : []),
  ]);
  const defaultTab = canViewChannels ? 'channels' : 'topups';
  const activeTab = requestedTab && allowedTabs.has(requestedTab) ? requestedTab : defaultTab;

  useUnsavedChangesGuard({
    cancelText: t('admin.payments.unsaved.cancel', 'Continue editing'),
    confirmText: t('admin.payments.unsaved.confirm', 'Discard changes'),
    isDirty: channelDirty && activeTab === 'channels',
    message: t(
      'admin.payments.unsaved.message',
      'The payment channel form has unsaved changes. Discard them and leave this page?',
    ),
    title: t('admin.payments.unsaved.title', 'Discard payment changes?'),
  });

  const changeTab = (key: string) => {
    if (
      !PAYMENT_CENTER_TABS.has(key as PaymentCenterTab) ||
      !allowedTabs.has(key as PaymentCenterTab)
    )
      return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', key);
      return next;
    });
  };

  const tabItems = [
    canViewChannels
      ? {
          children: <PaymentChannelSettings onDirtyChange={setChannelDirty} />,
          key: 'channels' as const,
          label: t('admin.payments.tabs.channels', 'Channel configuration'),
        }
      : null,
    canViewFinance
      ? {
          children: <SubscriptionPaymentsPage />,
          key: 'subscriptions' as const,
          label: t('admin.payments.tabs.subscriptions', 'Plan transactions'),
        }
      : null,
    canViewFinance
      ? {
          children: <TopUpPaymentsPage />,
          key: 'topups' as const,
          label: t('admin.payments.tabs.topups', 'Top-up transactions'),
        }
      : null,
    canViewFinance
      ? {
          children: <ModulePaymentsPage embedded />,
          key: 'moduleApps' as const,
          label: t('admin.payments.tabs.moduleApps', 'Module payments'),
        }
      : null,
    canViewFinance
      ? {
          children: <CreditSettlementFailuresPage />,
          key: 'settlements' as const,
          label: t('admin.payments.tabs.settlements', 'Settlement failures'),
        }
      : null,
  ].filter(Boolean) as Array<{ children: ReactNode; key: PaymentCenterTab; label: string }>;

  return (
    <AdminPageShell
      title={t('admin.payments.title', 'Payment center')}
      width="full"
      description={t(
        'admin.payments.subtitle',
        'Manage payment methods, plan purchases, online top-ups, and module-payment diagnostics.',
      )}
    >
      <Tabs activeKey={activeTab} items={tabItems} onChange={changeTab} />
    </AdminPageShell>
  );
};

export default AdminPaymentsPage;
