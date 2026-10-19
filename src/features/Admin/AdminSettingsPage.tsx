'use client';

import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Flexbox } from '@lobehub/ui';
import { Button, Select, Tabs } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, message, Switch, Typography } from 'antd';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { DEFAULT_COMHUB_AGENT_AVATAR } from '@/const/defaultAgent';
import { HELP_MENU_ACTIONS, HELP_MENU_ICONS } from '@/const/helpMenu';
import { SETTINGS_SUBTITLE } from '@/features/Admin/adminSettingsCopy';
import {
  type AdminSettingsFormValues,
  buildFormValues,
  buildSettingMaterializationUpdates,
  buildSettingUpdates,
  getAdminSettingsRefreshKeys,
} from '@/features/Admin/adminSettingsForm';
import ImageUrlUploadInput from '@/features/Admin/components/ImageUrlUploadInput';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminSettingsGovernanceCard from './AdminSettingsGovernanceCard';
import { AdminFormActions, AdminPageError, AdminPageShell } from './layout';

const { Text } = Typography;

const helpMenuActionOptions = HELP_MENU_ACTIONS.map((value) => ({ label: value, value }));
const helpMenuIconOptions = HELP_MENU_ICONS.map((value) => ({ label: value, value }));

const aboutLinkGroups = [
  { key: 'contact', title: '联系入口', titleKey: 'admin.settings.aboutLinks.contact' },
  { key: 'information', title: '社区与资讯', titleKey: 'admin.settings.aboutLinks.information' },
  { key: 'legal', title: '法律声明', titleKey: 'admin.settings.aboutLinks.legal' },
] as const;

const AdminSettingsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('settings'), () =>
    adminCommercialService.getSettingsSection('settings'),
  );
  const { data: storageSettings } = useClientDataSWR(
    ADMIN_SETTINGS_SECTION_SWR_KEY('file-storage'),
    () => adminCommercialService.getSettingsSection('file-storage'),
  );
  const [form] = Form.useForm<AdminSettingsFormValues>();
  const [materializing, setMaterializing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [committedValues, setCommittedValues] = useState<AdminSettingsFormValues>();
  const hasHydratedForm = useRef(false);

  const watchedValues = Form.useWatch([], form) as Partial<AdminSettingsFormValues> | undefined;
  const initialValues = useMemo(
    () => committedValues ?? buildFormValues(data),
    [committedValues, data],
  );
  const pendingUpdates = buildSettingUpdates(watchedValues ?? initialValues, initialValues);
  const hasPendingChanges = pendingUpdates.length > 0;
  const uploadPublicUrlPrefix = storageSettings?.storageS3PublicDomain || undefined;

  useEffect(() => {
    if (!data || hasHydratedForm.current) return;

    const nextValues = buildFormValues(data);
    hasHydratedForm.current = true;
    setCommittedValues(nextValues);
    form.setFieldsValue(nextValues);
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    try {
      const values = await form.validateFields();
      const updates = buildSettingUpdates(values, initialValues);

      if (updates.length === 0) {
        message.info(t('admin.settings.noChanges', '没有需要保存的变更'));
        return;
      }

      setSubmitting(true);
      await adminCommercialService.setAppSettingsBatch({ updates });

      // Keep the full form baseline local. The write service revalidates the
      // settings cache, but that response can arrive while another tab still
      // has stale data. Rehydrating the whole form from it loses saved values.
      const nextCommittedValues = buildFormValues(values);
      setCommittedValues(nextCommittedValues);
      form.setFieldsValue(nextCommittedValues);

      const refreshKeys = getAdminSettingsRefreshKeys(updates);
      for (const key of refreshKeys) {
        await mutate(key);
      }

      message.success(t('admin.settings.saveSuccess', '设置已保存'));
    } catch {
      message.error(t('admin.settings.saveFailed', '保存失败，请检查表单内容'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMaterializeDefaults = async () => {
    if (!data) return;

    try {
      const values = await form.validateFields();
      const updates = buildSettingMaterializationUpdates(values);

      setMaterializing(true);
      await adminCommercialService.setAppSettingsBatch({ updates });

      const nextCommittedValues = buildFormValues(values);
      setCommittedValues(nextCommittedValues);
      form.setFieldsValue(nextCommittedValues);

      const refreshKeys = getAdminSettingsRefreshKeys(updates);
      for (const key of refreshKeys) {
        await mutate(key);
      }

      message.success(
        t('admin.settings.materializeDefaultsSuccess', '推荐默认配置已同步到后台设置'),
      );
    } catch {
      message.error(
        t('admin.settings.materializeDefaultsFailed', '同步失败，请检查表单内容后重试'),
      );
    } finally {
      setMaterializing(false);
    }
  };

  const renderAboutLinkGroup = (group: (typeof aboutLinkGroups)[number]) => (
    <Form.List key={group.key} name={['aboutLinks', group.key]}>
      {(fields) => (
        <Flexbox gap={8}>
          <Text strong>{t(group.titleKey, group.title)}</Text>
          {fields.map(({ key, name, ...restField }) => (
            <Flexbox horizontal align="center" gap={8} key={key}>
              <Form.Item {...restField} hidden name={[name, 'id']}>
                <Input />
              </Form.Item>
              <Form.Item
                {...restField}
                noStyle
                name={[name, 'label']}
                rules={[
                  {
                    message: t('admin.settings.aboutLinks.labelRequired', '请填写名称'),
                    required: true,
                  },
                ]}
              >
                <Input
                  placeholder={t('admin.settings.aboutLinks.label', '名称')}
                  style={{ flex: 1 }}
                />
              </Form.Item>
              <Form.Item
                {...restField}
                noStyle
                name={[name, 'url']}
                rules={[
                  {
                    message: t('admin.settings.aboutLinks.urlRequired', '请填写链接'),
                    required: true,
                  },
                ]}
              >
                <Input placeholder="https://..." style={{ flex: 1.6 }} />
              </Form.Item>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Form.List>
  );

  return (
    <AdminPageShell
      description={t('admin.settings.subtitle', SETTINGS_SUBTITLE)}
      title={t('admin.settings.title', '站点基础设置')}
      width="medium"
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.settings.scopeNotice',
          '这里仅维护站点基础展示。默认模型请到“模型与计费矩阵”，文件存储请到“文件存储”，Cron 与记忆任务请到“系统维护”，客户端配置请到“客户端”。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.settings.loadFailed', '无法读取当前站点设置，请重试。')}
          onRetry={refresh}
        />
      ) : null}

      <AdminSettingsGovernanceCard />

      <Form disabled={isLoading || !data} form={form} layout="vertical">
        <Tabs
          items={[
            {
              children: (
                <Card>
                  <Form.Item
                    label={t('admin.settings.brandName', '品牌名称')}
                    name="brandName"
                    extra={t(
                      'admin.settings.brandName.help',
                      '用于页面标题、导航、关于页面和站内品牌展示。',
                    )}
                  >
                    <Input placeholder="驰拓 AI" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandLoadingText', '加载页文案')}
                    name="brandLoadingText"
                    extra={t(
                      'admin.settings.brandLoadingText.help',
                      '用于首屏静态加载和 React 接管后的页面中央加载状态。',
                    )}
                  >
                    <Input placeholder="与 Agent 团队一起无限进步" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandLoadingSvgUrl', 'Loading SVG URL')}
                    name="brandLoadingSvgUrl"
                    extra={t(
                      'admin.settings.brandLoadingSvgUrl.help',
                      'Replaces the startup loading SVG. Supports an internal path or a full HTTPS URL. Leave empty to use the default loading style.',
                    )}
                  >
                    <Input placeholder="/images/brand/loading.svg" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandAuthTitle', '登录页主文案')}
                    name="brandAuthTitle"
                    extra={t(
                      'admin.settings.brandAuthTitle.help',
                      '显示在登录和注册表单上方，例如 Agent teammates that grow with you。',
                    )}
                  >
                    <Input placeholder="Agent teammates that grow with you" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandCopyrightText', '登录页底部版权')}
                    name="brandCopyrightText"
                    extra={t(
                      'admin.settings.brandCopyrightText.help',
                      '显示在登录页底部，留空时使用默认版权文案。',
                    )}
                  >
                    <Input placeholder="© 2026 驰拓 AI. All rights reserved." />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandLogoUrl', 'Logo 地址（URL）')}
                    name="brandLogoUrl"
                    extra={t(
                      'admin.settings.brandLogoUrl.help',
                      '用于登录页右上角、站内品牌 Logo 和图标展示。可填写 URL，也可上传图片后自动填入。',
                    )}
                  >
                    <ImageUrlUploadInput
                      placeholder="https://.../logo.svg"
                      publicUrlPrefix={uploadPublicUrlPrefix}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandFaviconUrl', '网站图标地址（Favicon URL）')}
                    name="brandFaviconUrl"
                    extra={t(
                      'admin.settings.brandFaviconUrl.help',
                      '用于浏览器标签页和收藏夹图标。可填写 URL，也可上传图片后自动填入。',
                    )}
                  >
                    <ImageUrlUploadInput
                      placeholder="https://.../favicon.ico"
                      publicUrlPrefix={uploadPublicUrlPrefix}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.aboutLogoUrl', '关于页面 Logo 地址')}
                    name="aboutLogoUrl"
                    extra={t(
                      'admin.settings.aboutLogoUrl.help',
                      '用于“关于”页面的 Logo。留空时使用站点 Logo；可填写 URL，也可上传图片后自动填入。',
                    )}
                  >
                    <ImageUrlUploadInput
                      placeholder="https://.../about-logo.svg"
                      publicUrlPrefix={uploadPublicUrlPrefix}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandPrimaryColor', '主题主色')}
                    name="brandPrimaryColor"
                    extra={t(
                      'admin.settings.brandPrimary.help',
                      '填写十六进制颜色值，例如 #1677ff。',
                    )}
                  >
                    <Input placeholder="#1677ff" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.brandSlogan', '品牌标语')}
                    name="brandSlogan"
                    extra={t(
                      'admin.settings.brandSlogan.help',
                      '用于公开展示页和旧版品牌文案兜底。',
                    )}
                  >
                    <Input placeholder="与 Agent 团队一起无限进步" />
                  </Form.Item>
                </Card>
              ),
              key: 'brand',
              label: t('admin.settings.brandTab', '品牌与登录'),
            },
            {
              children: (
                <Card>
                  <Form.Item
                    label={t('admin.settings.defaultAgentName', '助手名称')}
                    name="defaultAgentName"
                    extra={t(
                      'admin.settings.defaultAgentName.help',
                      '用于新用户默认会话、欢迎页和侧边栏中的助手名称。',
                    )}
                  >
                    <Input placeholder="驰拓助手" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.defaultAgentAvatar', '助手头像代码')}
                    name="defaultAgentAvatar"
                    extra={t(
                      'admin.settings.defaultAgentAvatar.help',
                      '支持图片 URL、站内路径或 emoji。留空时使用默认头像。',
                    )}
                  >
                    <ImageUrlUploadInput
                      placeholder={DEFAULT_COMHUB_AGENT_AVATAR}
                      publicUrlPrefix={uploadPublicUrlPrefix}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.defaultSkillName', '默认技能名称')}
                    name="defaultSkillName"
                    extra={t(
                      'admin.settings.defaultSkillName.help',
                      '用于配置内置默认技能的显示名称；留空时使用品牌名称。',
                    )}
                  >
                    <Input
                      placeholder={t('admin.settings.defaultSkillName.placeholder', '驰拓技能')}
                    />
                  </Form.Item>
                </Card>
              ),
              key: 'assistant',
              label: t('admin.settings.assistantTab', '默认助手外观'),
            },
            {
              children: (
                <Card>
                  <Form.Item
                    label={t('admin.settings.homeMessengerEnabled', '启用首页聊天平台入口')}
                    name="homeMessengerEnabled"
                    valuePropName="checked"
                    extra={t(
                      'admin.settings.homeMessengerEnabled.help',
                      '关闭后首页聊天框下方不会再随机显示聊天平台入口；/settings/messenger 功能页仍保留。',
                    )}
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.homeMessengerBannerTitle', '首页聊天平台文案')}
                    name="homeMessengerBannerTitle"
                    extra={t(
                      'admin.settings.homeMessengerBannerTitle.help',
                      '控制首页聊天框下方“聊天平台”入口文字，留空时使用系统默认文案。',
                    )}
                  >
                    <Input placeholder="在你喜爱的聊天应用中，与 {{brandName}} 畅聊" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.communityForkAndChatLabel', '社区派生按钮文字')}
                    name="communityForkAndChatLabel"
                    extra={t(
                      'admin.settings.communityForkAndChatLabel.help',
                      '控制社区详情页派生按钮文字，留空时使用系统默认文案。',
                    )}
                  >
                    <Input placeholder="派生并聊天" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.communitySkillUseButtonLabel', 'Skill 使用按钮文字')}
                    name="communitySkillUseButtonLabel"
                    extra={t(
                      'admin.settings.communitySkillUseButtonLabel.help',
                      '控制 Skill 详情页“在当前平台使用”按钮文字，留空时使用当前品牌名生成默认文案。',
                    )}
                  >
                    <Input placeholder="在驰拓 AI 助手中使用" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.sidebarMemberLabel', '侧栏会员按钮名称')}
                    name="sidebarMemberLabel"
                    extra={t(
                      'admin.settings.sidebarMemberLabel.help',
                      '显示在侧栏首页下方的会员入口，留空时显示“会员”。',
                    )}
                  >
                    <Input placeholder="会员" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.sidebarMemberUrl', '侧栏会员按钮链接')}
                    name="sidebarMemberUrl"
                    extra={t(
                      'admin.settings.sidebarMemberUrl.help',
                      '会员入口点击后打开的站内或外部链接，默认 /settings/plans。',
                    )}
                  >
                    <Input placeholder="/settings/plans" />
                  </Form.Item>
                  <Form.Item
                    label={t('admin.settings.sidebarGenerationLabel', '侧栏生成按钮名称')}
                    name="sidebarGenerationLabel"
                    extra={t(
                      'admin.settings.sidebarGenerationLabel.help',
                      '控制侧栏 /image 生成入口显示名称，留空时显示“生成”。',
                    )}
                  >
                    <Input placeholder="生成" />
                  </Form.Item>
                </Card>
              ),
              key: 'entry',
              label: t('admin.settings.entryTab', '站点入口文案'),
            },
            {
              children: (
                <Card>
                  <Flexbox gap={16}>
                    <Text type="secondary">
                      {t(
                        'admin.settings.aboutLinks.help',
                        'Configure settings/about links. Labels and URLs display from this page; blank values use defaults.',
                      )}
                    </Text>
                    {aboutLinkGroups.map(renderAboutLinkGroup)}
                    <Text strong>
                      {t('admin.settings.aboutPageVersion', 'About page version area')}
                    </Text>
                    <Form.Item
                      label={t('admin.settings.aboutPageLogoLinkUrl', 'Logo link URL')}
                      name={['aboutPage', 'logoLinkUrl']}
                      extra={t(
                        'admin.settings.aboutPageLogoLinkUrl.help',
                        'Controls the settings/about version logo link. Blank values use the official site.',
                      )}
                    >
                      <Input placeholder="https://example.com" />
                    </Form.Item>
                    <Form.Item
                      label={t('admin.settings.aboutPageChangelogLabel', 'Changelog button label')}
                      name={['aboutPage', 'changelogLabel']}
                      extra={t(
                        'admin.settings.aboutPageChangelogLabel.help',
                        'Blank values use the default changelog translation.',
                      )}
                    >
                      <Input placeholder={t('changelog', 'Changelog')} />
                    </Form.Item>
                    <Form.Item
                      label={t('admin.settings.aboutPageChangelogUrl', 'Changelog URL')}
                      name={['aboutPage', 'changelogUrl']}
                    >
                      <Input placeholder="https://example.com/changelog" />
                    </Form.Item>
                    <Form.Item
                      label={t('admin.settings.helpMenuItems', '帮助菜单')}
                      extra={t(
                        'admin.settings.helpMenuItems.help',
                        '配置客户端帮助菜单。每项需要显示名称，链接 URL 可选。',
                      )}
                    >
                      <Form.List name="helpMenuItems">
                        {(fields, { add, remove }) => (
                          <Flexbox gap={8}>
                            {fields.map(({ key, name, ...restField }) => (
                              <Flexbox
                                horizontal
                                align="center"
                                gap={8}
                                key={key}
                                style={{ flexWrap: 'wrap' }}
                              >
                                <Form.Item {...restField} hidden name={[name, 'key']}>
                                  <Input />
                                </Form.Item>
                                <Form.Item
                                  {...restField}
                                  noStyle
                                  name={[name, 'label']}
                                  rules={[
                                    { message: 'Please enter a display name', required: true },
                                  ]}
                                >
                                  <Input placeholder="Display name" style={{ flex: 1 }} />
                                </Form.Item>
                                <Form.Item {...restField} noStyle name={[name, 'icon']}>
                                  <Select
                                    options={helpMenuIconOptions}
                                    placeholder="icon"
                                    style={{ minWidth: 132 }}
                                  />
                                </Form.Item>
                                <Form.Item {...restField} noStyle name={[name, 'action']}>
                                  <Select
                                    options={helpMenuActionOptions}
                                    placeholder="action"
                                    style={{ minWidth: 144 }}
                                  />
                                </Form.Item>
                                <Form.Item {...restField} noStyle name={[name, 'url']}>
                                  <Input placeholder="https://..." style={{ flex: 1.5 }} />
                                </Form.Item>
                                <MinusCircleOutlined
                                  style={{ color: '#ff4d4f' }}
                                  onClick={() => remove(name)}
                                />
                              </Flexbox>
                            ))}
                            <Button
                              block
                              icon={<PlusOutlined />}
                              type="dashed"
                              onClick={() =>
                                add({
                                  action: 'url',
                                  enabled: true,
                                  icon: 'help',
                                  label: '',
                                  url: '',
                                })
                              }
                            >
                              {t('admin.settings.helpMenuAdd', '添加菜单项')}
                            </Button>
                          </Flexbox>
                        )}
                      </Form.List>
                    </Form.Item>
                  </Flexbox>
                </Card>
              ),
              key: 'links',
              label: t('admin.settings.linksTab', '关于与帮助'),
            },
          ]}
        />

        <AdminFormActions label={t('admin.settings.actions', '站点设置操作')}>
          {hasPendingChanges ? (
            <Text type="secondary">有 {pendingUpdates.length} 项待保存</Text>
          ) : null}
          <Button
            disabled={isLoading || !data || submitting}
            loading={materializing}
            onClick={handleMaterializeDefaults}
          >
            {t('admin.settings.materializeDefaults', '同步推荐默认配置')}
          </Button>
          <Button
            disabled={isLoading || !data || !hasPendingChanges || materializing}
            loading={submitting}
            type="primary"
            onClick={handleSave}
          >
            {t('admin.settings.save', '保存设置')}
          </Button>
        </AdminFormActions>
      </Form>
    </AdminPageShell>
  );
});

AdminSettingsPage.displayName = 'AdminSettingsPage';

export default AdminSettingsPage;
