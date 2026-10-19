'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, InputNumber, message, Switch } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import { ADMIN_SETTINGS_SECTION_SWR_KEY } from '@/const/adminCacheKeys';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { SkillSorts } from '@/types/discover';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

const SETTING_KEYS = {
  announcementContent: 'community.homeAnnouncement.content',
  announcementEnabled: 'community.homeAnnouncement.enabled',
  announcementTitle: 'community.homeAnnouncement.title',
  announcementType: 'community.homeAnnouncement.type',
  creatorRewardBannerEnabled: 'community.creatorRewardBanner.enabled',
  featuredAssistantPageSize: 'community.featuredAssistant.pageSize',
  featuredAssistantTitle: 'community.featuredAssistant.title',
  featuredAssistantsEnabled: 'community.featuredAssistants.enabled',
  featuredMcpPageSize: 'community.featuredMcp.pageSize',
  featuredMcpTitle: 'community.featuredMcp.title',
  featuredMcpsEnabled: 'community.featuredMcps.enabled',
  featuredSkillCategory: 'community.featuredSkill.category',
  featuredSkillPageSize: 'community.featuredSkill.pageSize',
  featuredSkillSort: 'community.featuredSkill.sort',
  featuredSkillTitle: 'community.featuredSkill.title',
  featuredSkillsEnabled: 'community.featuredSkills.enabled',
} as const;

type FormValues = {
  announcementContent: string;
  announcementEnabled: boolean;
  announcementTitle: string;
  announcementType: 'success' | 'info' | 'warning' | 'error';
  creatorRewardBannerEnabled: boolean;
  featuredAssistantPageSize: number;
  featuredAssistantTitle: string;
  featuredAssistantsEnabled: boolean;
  featuredMcpPageSize: number;
  featuredMcpTitle: string;
  featuredMcpsEnabled: boolean;
  featuredSkillCategory: string;
  featuredSkillPageSize: number;
  featuredSkillSort: SkillSorts;
  featuredSkillTitle: string;
  featuredSkillsEnabled: boolean;
};

const AdminOperationsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('operations'), () =>
    adminCommercialService.getSettingsSection('operations'),
  );

  useEffect(() => {
    if (!data?.operationsConfig) return;
    const config = data.operationsConfig;
    form.setFieldsValue({
      announcementContent: config.announcement.content,
      announcementEnabled: config.announcement.enabled,
      announcementTitle: config.announcement.title,
      announcementType: config.announcement.type as FormValues['announcementType'],
      creatorRewardBannerEnabled: config.creatorRewardBannerEnabled,
      featuredAssistantPageSize: config.featuredAssistants.pageSize,
      featuredAssistantTitle: config.featuredAssistants.title,
      featuredAssistantsEnabled: config.featuredAssistants.enabled,
      featuredMcpPageSize: config.featuredMcps.pageSize,
      featuredMcpTitle: config.featuredMcps.title,
      featuredMcpsEnabled: config.featuredMcps.enabled,
      featuredSkillCategory: config.featuredSkills.category,
      featuredSkillPageSize: config.featuredSkills.pageSize,
      featuredSkillSort: config.featuredSkills.sort as SkillSorts,
      featuredSkillTitle: config.featuredSkills.title,
      featuredSkillsEnabled: config.featuredSkills.enabled,
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
            key: SETTING_KEYS.creatorRewardBannerEnabled,
            value: values.creatorRewardBannerEnabled,
          },
          {
            key: SETTING_KEYS.featuredAssistantsEnabled,
            value: values.featuredAssistantsEnabled,
          },
          {
            key: SETTING_KEYS.featuredAssistantPageSize,
            value: values.featuredAssistantPageSize,
          },
          {
            key: SETTING_KEYS.featuredAssistantTitle,
            value: values.featuredAssistantTitle,
          },
          {
            key: SETTING_KEYS.featuredMcpsEnabled,
            value: values.featuredMcpsEnabled,
          },
          {
            key: SETTING_KEYS.featuredMcpPageSize,
            value: values.featuredMcpPageSize,
          },
          {
            key: SETTING_KEYS.featuredMcpTitle,
            value: values.featuredMcpTitle,
          },
          {
            key: SETTING_KEYS.featuredSkillsEnabled,
            value: values.featuredSkillsEnabled,
          },
          {
            key: SETTING_KEYS.featuredSkillPageSize,
            value: values.featuredSkillPageSize,
          },
          {
            key: SETTING_KEYS.featuredSkillTitle,
            value: values.featuredSkillTitle,
          },
          {
            key: SETTING_KEYS.featuredSkillCategory,
            value: values.featuredSkillCategory,
          },
          {
            key: SETTING_KEYS.featuredSkillSort,
            value: values.featuredSkillSort || SkillSorts.InstallCount,
          },
          {
            key: SETTING_KEYS.announcementEnabled,
            value: values.announcementEnabled,
          },
          {
            key: SETTING_KEYS.announcementTitle,
            value: values.announcementTitle,
          },
          {
            key: SETTING_KEYS.announcementContent,
            value: values.announcementContent,
          },
          {
            key: SETTING_KEYS.announcementType,
            value: values.announcementType,
          },
        ],
      });
      message.success(t('admin.operations.saveSuccess', '运营配置已保存'));
    } catch {
      message.error(t('admin.operations.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.operations.title', '运营开关')}
      width="medium"
      description={t(
        'admin.operations.subtitle',
        '集中控制社区首页公告、创作者奖励横幅和精选内容展示。',
      )}
    >
      <Alert
        showIcon
        message={t('admin.operations.tip', '这些配置会公开用于社区首页展示，不会暴露敏感数据。')}
        type="info"
      />
      {error ? (
        <AdminPageError
          description={t('admin.operations.loadFailed', '无法读取当前运营配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}
      <Form
        disabled={isLoading}
        form={form}
        layout="vertical"
        initialValues={{
          announcementEnabled: false,
          announcementType: 'info',
          creatorRewardBannerEnabled: true,
          featuredAssistantPageSize: 12,
          featuredAssistantsEnabled: true,
          featuredMcpPageSize: 12,
          featuredMcpsEnabled: true,
          featuredSkillPageSize: 8,
          featuredSkillSort: SkillSorts.InstallCount,
          featuredSkillsEnabled: false,
        }}
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.operations.bannerSection', '社区横幅')}
            description={t(
              'admin.operations.bannerSectionDescription',
              '管理社区入口的奖励提示和首页公告内容。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.operations.creatorRewardBanner', '显示创作者奖励横幅')}
                name="creatorRewardBannerEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.operations.announcementEnabled', '显示首页公告')}
                name="announcementEnabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.operations.announcementType', '公告类型')}
                name="announcementType"
              >
                <Select
                  disabled={isLoading}
                  options={[
                    { label: '信息（Info）', value: 'info' },
                    { label: '成功（Success）', value: 'success' },
                    { label: '警告（Warning）', value: 'warning' },
                    { label: '错误（Error）', value: 'error' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label={t('admin.operations.announcementTitle', '公告标题')}
                name="announcementTitle"
              >
                <Input />
              </Form.Item>
            </AdminFormGrid>
            <Form.Item
              label={t('admin.operations.announcementContent', '公告内容')}
              name="announcementContent"
            >
              <Input.TextArea rows={4} />
            </Form.Item>
          </AdminSection>

          <AdminSection
            title={t('admin.operations.featuredSection', '精选模块')}
            description={t(
              'admin.operations.featuredSectionDescription',
              '分别设置首页精选助手、工具和技能的标题、数量与排序。',
            )}
          >
            <AdminFormGrid columns={3} label={t('admin.operations.featuredSection', '精选模块')}>
              <Card title={t('admin.operations.featuredAssistantsGroup', '精选助手')}>
                <Form.Item
                  label={t('admin.operations.featuredAssistantsEnabled', '显示精选助手')}
                  name="featuredAssistantsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredAssistantTitle', '助手模块标题')}
                  name="featuredAssistantTitle"
                >
                  <Input placeholder={t('home.featuredAssistants', { ns: 'discover' })} />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredAssistantPageSize', '助手数量')}
                  name="featuredAssistantPageSize"
                >
                  <InputNumber max={24} min={1} style={{ width: '100%' }} />
                </Form.Item>
              </Card>

              <Card title={t('admin.operations.featuredMcpsGroup', '精选 MCP / 工具')}>
                <Form.Item
                  label={t('admin.operations.featuredMcpsEnabled', '显示精选 MCP/工具')}
                  name="featuredMcpsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredMcpTitle', 'MCP 模块标题')}
                  name="featuredMcpTitle"
                >
                  <Input placeholder={t('home.featuredTools', { ns: 'discover' })} />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredMcpPageSize', 'MCP 数量')}
                  name="featuredMcpPageSize"
                >
                  <InputNumber max={24} min={1} style={{ width: '100%' }} />
                </Form.Item>
              </Card>

              <Card title={t('admin.operations.featuredSkillsGroup', '精选技能')}>
                <Form.Item
                  label={t('admin.operations.featuredSkillsEnabled', '显示精选技能')}
                  name="featuredSkillsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredSkillTitle', '技能模块标题')}
                  name="featuredSkillTitle"
                >
                  <Input placeholder={t('admin.operations.defaultSkillTitle', '精选技能')} />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredSkillCategory', '技能分类')}
                  name="featuredSkillCategory"
                >
                  <Input placeholder="productivity-tasks" />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredSkillSort', '技能排序')}
                  name="featuredSkillSort"
                >
                  <Select
                    disabled={isLoading}
                    options={[
                      { label: '安装量（Install Count）', value: SkillSorts.InstallCount },
                      { label: '星标数（Stars）', value: SkillSorts.Stars },
                      { label: '更新时间（Updated At）', value: SkillSorts.UpdatedAt },
                      { label: '创建时间（Created At）', value: SkillSorts.CreatedAt },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label={t('admin.operations.featuredSkillPageSize', '技能数量')}
                  name="featuredSkillPageSize"
                >
                  <InputNumber max={24} min={1} style={{ width: '100%' }} />
                </Form.Item>
              </Card>
            </AdminFormGrid>
          </AdminSection>

          <AdminFormActions label={t('admin.operations.actions', '运营配置操作')}>
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

AdminOperationsPage.displayName = 'AdminOperationsPage';

export default AdminOperationsPage;
