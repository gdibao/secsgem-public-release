'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, message, Switch } from 'antd';
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
  assistantsEnabled: 'recommendation.assistants.enabled',
  assistantTags: 'recommendation.assistantTags',
  assistantTitle: 'recommendation.assistantTitle',
  enabled: 'recommendation.section.enabled',
  generalSkillsEnabled: 'recommendation.generalSkills.enabled',
  generalSkillCategories: 'recommendation.generalSkillCategories',
  generalSkillTitle: 'recommendation.generalSkillTitle',
  hotSkillsEnabled: 'recommendation.hotSkills.enabled',
  hotSkillSort: 'recommendation.hotSkillSort',
  hotSkillTitle: 'recommendation.hotSkillTitle',
  mcpsEnabled: 'recommendation.mcps.enabled',
  mcpCategories: 'recommendation.mcpCategories',
  mcpTitle: 'recommendation.mcpTitle',
  selectedTags: 'recommendation.selectedTags',
  skillsEnabled: 'recommendation.skills.enabled',
  skillCategories: 'recommendation.skillCategories',
  skillTitle: 'recommendation.skillTitle',
} as const;

type FormValues = {
  assistantsEnabled: boolean;
  assistantTags: string;
  assistantTitle: string;
  enabled: boolean;
  generalSkillsEnabled: boolean;
  generalSkillCategories: string;
  generalSkillTitle: string;
  hotSkillsEnabled: boolean;
  hotSkillSort: SkillSorts;
  hotSkillTitle: string;
  mcpsEnabled: boolean;
  mcpCategories: string;
  mcpTitle: string;
  selectedTags: string;
  skillsEnabled: boolean;
  skillCategories: string;
  skillTitle: string;
};

const splitList = (value: unknown) =>
  (typeof value === 'string' ? value.split(/[\r\n,;；，]+/) : [])
    .map((item) => item.trim())
    .filter(Boolean);
const joinList = (value?: string[]) => (value ?? []).join('\n');

const AdminRecommendationsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('recommendations'), () =>
    adminCommercialService.getSettingsSection('recommendations'),
  );

  useEffect(() => {
    if (!data?.recommendationConfig) return;
    form.setFieldsValue({
      assistantsEnabled: data.recommendationConfig.assistantsEnabled,
      assistantTags: joinList(data.recommendationConfig.assistantTags),
      assistantTitle: data.recommendationConfig.assistantTitle,
      enabled: data.recommendationConfig.enabled,
      generalSkillsEnabled: data.recommendationConfig.generalSkillsEnabled,
      generalSkillCategories: joinList(data.recommendationConfig.generalSkillCategories),
      generalSkillTitle: data.recommendationConfig.generalSkillTitle,
      hotSkillsEnabled: data.recommendationConfig.hotSkillsEnabled,
      hotSkillSort: data.recommendationConfig.hotSkillSort as SkillSorts,
      hotSkillTitle: data.recommendationConfig.hotSkillTitle,
      mcpsEnabled: data.recommendationConfig.mcpsEnabled,
      mcpCategories: joinList(data.recommendationConfig.mcpCategories),
      mcpTitle: data.recommendationConfig.mcpTitle,
      selectedTags: joinList(data.recommendationConfig.selectedTags),
      skillsEnabled: data.recommendationConfig.skillsEnabled,
      skillCategories: joinList(data.recommendationConfig.skillCategories),
      skillTitle: data.recommendationConfig.skillTitle,
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
            key: SETTING_KEYS.enabled,
            value: Boolean(values.enabled),
          },
          {
            key: SETTING_KEYS.assistantsEnabled,
            value: Boolean(values.assistantsEnabled),
          },
          {
            key: SETTING_KEYS.mcpsEnabled,
            value: Boolean(values.mcpsEnabled),
          },
          {
            key: SETTING_KEYS.skillsEnabled,
            value: Boolean(values.skillsEnabled),
          },
          {
            key: SETTING_KEYS.generalSkillsEnabled,
            value: Boolean(values.generalSkillsEnabled),
          },
          {
            key: SETTING_KEYS.hotSkillsEnabled,
            value: Boolean(values.hotSkillsEnabled),
          },
          {
            key: SETTING_KEYS.selectedTags,
            value: splitList(values.selectedTags),
          },
          {
            key: SETTING_KEYS.assistantTags,
            value: splitList(values.assistantTags),
          },
          {
            key: SETTING_KEYS.assistantTitle,
            value: values.assistantTitle,
          },
          {
            key: SETTING_KEYS.skillCategories,
            value: splitList(values.skillCategories),
          },
          {
            key: SETTING_KEYS.skillTitle,
            value: values.skillTitle,
          },
          {
            key: SETTING_KEYS.mcpCategories,
            value: splitList(values.mcpCategories),
          },
          {
            key: SETTING_KEYS.mcpTitle,
            value: values.mcpTitle,
          },
          {
            key: SETTING_KEYS.generalSkillCategories,
            value: splitList(values.generalSkillCategories),
          },
          {
            key: SETTING_KEYS.generalSkillTitle,
            value: values.generalSkillTitle,
          },
          {
            key: SETTING_KEYS.hotSkillSort,
            value: values.hotSkillSort || SkillSorts.InstallCount,
          },
          {
            key: SETTING_KEYS.hotSkillTitle,
            value: values.hotSkillTitle,
          },
        ],
      });
      message.success(t('admin.recommendations.saveSuccess', '推荐配置已保存'));
    } catch {
      message.error(t('admin.recommendations.saveFailed', '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      title={t('admin.recommendations.title', '推荐内容')}
      width="medium"
      description={t(
        'admin.recommendations.subtitle',
        '统一配置社区推荐主题、助手、MCP 工具和技能版块。',
      )}
    >
      <Alert
        showIcon
        type="info"
        message={t(
          'admin.recommendations.scopeNotice',
          '推荐标签和分类会直接影响社区首页的公开筛选结果。',
        )}
      />
      {error ? (
        <AdminPageError
          description={t('admin.recommendations.loadFailed', '无法读取当前推荐配置，请重试。')}
          onRetry={refresh}
        />
      ) : null}
      <Form
        disabled={isLoading}
        form={form}
        layout="vertical"
        initialValues={{
          assistantsEnabled: true,
          enabled: false,
          generalSkillsEnabled: true,
          hotSkillSort: SkillSorts.InstallCount,
          hotSkillsEnabled: true,
          mcpsEnabled: true,
          skillsEnabled: true,
          assistantTitle: '为你推荐的助理',
          generalSkillTitle: '通用推荐技能',
          hotSkillTitle: '热门技能',
          mcpTitle: '推荐 MCP / 工具',
          skillTitle: '推荐技能',
        }}
      >
        <Flexbox gap={24}>
          <AdminSection
            title={t('admin.recommendations.criteria', '推荐条件')}
            description={t(
              'admin.recommendations.criteriaDescription',
              '总开关决定推荐模块是否展示；主题标签用于限定推荐范围。',
            )}
          >
            <AdminFormGrid>
              <Form.Item
                label={t('admin.recommendations.enabled', '启用推荐模块')}
                name="enabled"
                valuePropName="checked"
                extra={t(
                  'admin.recommendations.enabled.help',
                  '启用后，社区首页会显示由后台控制的推荐模块。',
                )}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={t('admin.recommendations.selectedTags', '用户选择标签')}
                name="selectedTags"
                extra={t(
                  'admin.recommendations.selectedTags.help',
                  '作为当前推荐主题展示的标签，每行填写一个。',
                )}
              >
                <Input.TextArea placeholder={'productivity\ncoding\nwriting'} rows={4} />
              </Form.Item>
            </AdminFormGrid>
          </AdminSection>

          <AdminSection
            title={t('admin.recommendations.sections', '推荐版块')}
            description={t(
              'admin.recommendations.sectionsDescription',
              '每个版块可独立控制显示状态、标题和筛选范围。',
            )}
          >
            <AdminFormGrid label={t('admin.recommendations.sections', '推荐版块')}>
              <Card title={t('admin.recommendations.assistantsCard', '推荐助手')}>
                <Form.Item
                  label={t('admin.recommendations.assistantsEnabled', '显示推荐助手')}
                  name="assistantsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.assistantTitle', '助手模块标题')}
                  name="assistantTitle"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.assistantTags', '助手标签/分类')}
                  name="assistantTags"
                >
                  <Input.TextArea placeholder={'programming\noffice\ntranslation'} rows={4} />
                </Form.Item>
              </Card>

              <Card title={t('admin.recommendations.mcpsCard', '推荐 MCP / 工具')}>
                <Form.Item
                  label={t('admin.recommendations.mcpsEnabled', '显示推荐 MCP/工具')}
                  name="mcpsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.mcpTitle', 'MCP 模块标题')}
                  name="mcpTitle"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.mcpCategories', 'MCP 分类')}
                  name="mcpCategories"
                >
                  <Input.TextArea placeholder={'productivity\ntools\nweb-search'} rows={4} />
                </Form.Item>
              </Card>

              <Card title={t('admin.recommendations.skillsCard', '推荐技能')}>
                <Form.Item
                  label={t('admin.recommendations.skillsEnabled', '显示推荐技能')}
                  name="skillsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.skillTitle', '技能模块标题')}
                  name="skillTitle"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.skillCategories', '推荐技能分类')}
                  name="skillCategories"
                >
                  <Input.TextArea placeholder={'coding-agents-ides\nsearch-research'} rows={4} />
                </Form.Item>
              </Card>

              <Card title={t('admin.recommendations.generalSkillsCard', '通用技能')}>
                <Form.Item
                  label={t('admin.recommendations.generalSkillsEnabled', '显示通用技能')}
                  name="generalSkillsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.generalSkillTitle', '通用技能模块标题')}
                  name="generalSkillTitle"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.generalSkillCategories', '通用技能分类')}
                  name="generalSkillCategories"
                >
                  <Input.TextArea placeholder={'productivity-tasks\nbrowser-automation'} rows={4} />
                </Form.Item>
              </Card>

              <Card title={t('admin.recommendations.hotSkillsCard', '热门技能')}>
                <Form.Item
                  label={t('admin.recommendations.hotSkillsEnabled', '显示热门技能')}
                  name="hotSkillsEnabled"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.hotSkillTitle', '热门技能模块标题')}
                  name="hotSkillTitle"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label={t('admin.recommendations.hotSkillSort', '热门技能排序')}
                  name="hotSkillSort"
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
              </Card>
            </AdminFormGrid>
          </AdminSection>

          <AdminFormActions label={t('admin.recommendations.actions', '推荐配置操作')}>
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

AdminRecommendationsPage.displayName = 'AdminRecommendationsPage';

export default AdminRecommendationsPage;
