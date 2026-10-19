'use client';

import { Avatar, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert, Form, type FormInstance, Input, message, Switch, Tooltip, Typography } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { Card } from '@/components/antd-compat/Card';
import {
  ADMIN_SETTINGS_SECTION_SWR_KEY,
  PUBLIC_EXPERT_PLAZA_SWR_KEY,
} from '@/const/adminCacheKeys';
import { DEFAULT_EXPERT_PLAZA_CONFIG, type ExpertPlazaCard } from '@/const/expertPlaza';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import {
  AdminFormActions,
  AdminFormGrid,
  AdminPageError,
  AdminPageShell,
  AdminSection,
} from './layout';

const { Text } = Typography;

const SETTING_KEYS = {
  cards: 'expertPlaza.cards',
  categories: 'expertPlaza.categories',
  description: 'expertPlaza.description',
  enabled: 'expertPlaza.enabled',
  name: 'expertPlaza.name',
} as const;

type CardFormValue = Omit<ExpertPlazaCard, 'tags'> & {
  tagsText?: string;
};

type FormValues = {
  cards: CardFormValue[];
  categoriesText: string;
  description: string;
  enabled: boolean;
  name: string;
};

const splitTextList = (value?: string) =>
  Array.from(
    new Set(
      (value ?? '')
        .split(/[\r\n,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const toFormValues = (data: any): FormValues => {
  const config = data?.expertPlazaConfig ?? DEFAULT_EXPERT_PLAZA_CONFIG;

  return {
    cards: (config.cards ?? []).map((item: ExpertPlazaCard) => ({
      ...item,
      tagsText: item.tags?.join('\n') ?? '',
    })),
    categoriesText: (config.categories ?? DEFAULT_EXPERT_PLAZA_CONFIG.categories).join('\n'),
    description: config.description ?? DEFAULT_EXPERT_PLAZA_CONFIG.description,
    enabled: config.enabled ?? DEFAULT_EXPERT_PLAZA_CONFIG.enabled,
    name: config.name ?? DEFAULT_EXPERT_PLAZA_CONFIG.name,
  };
};

const toCards = (cards: CardFormValue[]) =>
  (cards ?? []).map((item) => ({
    author: item.author?.trim() || undefined,
    avatar: item.avatar?.trim() || undefined,
    category: item.category?.trim() || undefined,
    description: item.description?.trim() || '',
    enabled: item.enabled !== false,
    featured: Boolean(item.featured),
    id: item.id?.trim() || item.title?.trim().toLowerCase().replaceAll(/\s+/g, '-'),
    metricLabel: item.metricLabel?.trim() || undefined,
    metricValue: item.metricValue?.trim() || undefined,
    tags: splitTextList(item.tagsText),
    title: item.title?.trim() || '',
    url: item.url?.trim() || undefined,
  }));

const AdminExpertPlazaPage = memo(() => {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('expert-plaza'), () =>
    adminCommercialService.getSettingsSection('expert-plaza'),
  );

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue(toFormValues(data));
  }, [data, form]);

  const handleSave = async () => {
    if (!data) return;

    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const cards = toCards(values.cards).filter(
        (item) => item.id && item.title && item.description,
      );

      await adminCommercialService.setAppSettingsBatch({
        updates: [
          { key: SETTING_KEYS.enabled, value: values.enabled },
          { key: SETTING_KEYS.name, value: values.name },
          {
            key: SETTING_KEYS.description,
            value: values.description,
          },
          {
            key: SETTING_KEYS.categories,
            value: splitTextList(values.categoriesText),
          },
          { key: SETTING_KEYS.cards, value: cards },
        ],
      });

      await mutate(PUBLIC_EXPERT_PLAZA_SWR_KEY);
      message.success('专家广场配置已保存');
    } catch {
      message.error('保存失败，请检查卡片必填字段');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPageShell
      description="配置专家广场入口、页面信息、分类和展示卡片。"
      title="专家广场"
      width="medium"
    >
      <Alert
        showIcon
        message="开启后左侧栏会显示该入口；卡片可跳转到内部路径或外部链接。未填写 URL 时仅作为展示卡片。"
        type="info"
      />
      {error ? (
        <AdminPageError description="无法读取当前专家广场配置，请重试。" onRetry={refresh} />
      ) : null}

      <Form
        disabled={isLoading}
        form={form}
        initialValues={toFormValues({ expertPlazaConfig: DEFAULT_EXPERT_PLAZA_CONFIG })}
        layout="vertical"
      >
        <Flexbox gap={24}>
          <AdminSection description="设置侧栏入口状态、公开栏目名称和页面分类。" title="入口与页面">
            <AdminFormGrid>
              <Form.Item label="启用侧栏入口" name="enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                label="栏目名称"
                name="name"
                rules={[{ message: '请填写栏目名称', required: true }]}
              >
                <Input placeholder="专家广场" />
              </Form.Item>
            </AdminFormGrid>
            <Form.Item label="页面说明" name="description">
              <Input.TextArea autoSize={{ minRows: 2 }} />
            </Form.Item>
            <Form.Item
              extra="每行一个分类，也支持逗号分隔。"
              label="分类列表"
              name="categoriesText"
            >
              <Input.TextArea autoSize={{ minRows: 4 }} />
            </Form.Item>
          </AdminSection>

          <AdminSection
            description="卡片按列表顺序展示；必填标题和描述，ID 留空时会根据标题生成。"
            title="卡片信息"
          >
            <Form.List name="cards">
              {(fields, { add, remove }) => (
                <Flexbox gap={12}>
                  {fields.map(({ key, name, ...restField }) => (
                    <Card
                      key={key}
                      size="small"
                      title={<SpacePreview form={form} name={name} />}
                      extra={
                        <Tooltip title="删除卡片">
                          <Button
                            danger
                            aria-label="删除卡片"
                            icon={<Trash2 aria-hidden size={16} />}
                            size="small"
                            onClick={() => remove(name)}
                          />
                        </Tooltip>
                      }
                    >
                      <Flexbox gap={12}>
                        <AdminFormGrid columns={3}>
                          <Form.Item {...restField} label="ID" name={[name, 'id']}>
                            <Input placeholder="finance-advisor" />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            label="标题"
                            name={[name, 'title']}
                            rules={[{ message: '请填写标题', required: true }]}
                          >
                            <Input placeholder="财务顾问" />
                          </Form.Item>
                          <Form.Item {...restField} label="分类" name={[name, 'category']}>
                            <Input placeholder="办公" />
                          </Form.Item>
                        </AdminFormGrid>
                        <Form.Item
                          {...restField}
                          label="描述"
                          name={[name, 'description']}
                          rules={[{ message: '请填写描述', required: true }]}
                        >
                          <Input.TextArea autoSize={{ minRows: 2 }} />
                        </Form.Item>
                        <AdminFormGrid>
                          <Form.Item {...restField} label="头像 / 图标地址" name={[name, 'avatar']}>
                            <Input placeholder="/images/avatar-presets/avatar-1.svg" />
                          </Form.Item>
                          <Form.Item {...restField} label="跳转链接" name={[name, 'url']}>
                            <Input placeholder="/market/..." />
                          </Form.Item>
                        </AdminFormGrid>
                        <AdminFormGrid columns={3}>
                          <Form.Item {...restField} label="作者/来源" name={[name, 'author']}>
                            <Input />
                          </Form.Item>
                          <Form.Item {...restField} label="指标名称" name={[name, 'metricLabel']}>
                            <Input placeholder="使用人数" />
                          </Form.Item>
                          <Form.Item {...restField} label="指标值" name={[name, 'metricValue']}>
                            <Input placeholder="1.2k" />
                          </Form.Item>
                        </AdminFormGrid>
                        <Form.Item
                          {...restField}
                          extra="每行一个标签，也支持逗号分隔。"
                          label="标签"
                          name={[name, 'tagsText']}
                        >
                          <Input.TextArea autoSize={{ minRows: 2 }} />
                        </Form.Item>
                        <AdminFormGrid>
                          <Form.Item
                            {...restField}
                            label="启用"
                            name={[name, 'enabled']}
                            valuePropName="checked"
                          >
                            <Switch defaultChecked />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            label="精选"
                            name={[name, 'featured']}
                            valuePropName="checked"
                          >
                            <Switch />
                          </Form.Item>
                        </AdminFormGrid>
                      </Flexbox>
                    </Card>
                  ))}
                  <Button
                    block
                    icon={<Plus aria-hidden size={16} />}
                    type="dashed"
                    onClick={() =>
                      add({
                        description: '',
                        enabled: true,
                        featured: false,
                        id: '',
                        tagsText: '',
                        title: '',
                      })
                    }
                  >
                    添加卡片
                  </Button>
                </Flexbox>
              )}
            </Form.List>
          </AdminSection>

          <AdminFormActions label="专家广场配置操作">
            <Button
              disabled={isLoading || !data}
              loading={submitting}
              type="primary"
              onClick={handleSave}
            >
              保存专家广场
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

const SpacePreview = ({ form, name }: { form: FormInstance<FormValues>; name: number }) => (
  <Form.Item noStyle shouldUpdate>
    {() => {
      const card = form.getFieldValue(['cards', name]) as CardFormValue | undefined;
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Avatar avatar={card?.avatar} size={32} title={card?.title ?? ''} />
          <Text strong>{card?.title || '新卡片'}</Text>
        </Flexbox>
      );
    }}
  </Form.Item>
);

AdminExpertPlazaPage.displayName = 'AdminExpertPlazaPage';

export default AdminExpertPlazaPage;
