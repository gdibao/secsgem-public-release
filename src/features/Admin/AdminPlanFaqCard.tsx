'use client';

import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Flexbox } from '@lobehub/ui';
import { Button, Form, Input, message, Switch } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import { ADMIN_SETTINGS_SECTION_SWR_KEY, PUBLIC_PLAN_FAQ_SWR_KEY } from '@/const/adminCacheKeys';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { normalizePlanFaqSettings,type PlanFaqItem } from '@/const/billingPresentation';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

type PlanFaqFormValues = {
  planFaqItems: PlanFaqItem[];
};

const AdminPlanFaqCard = memo(() => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<PlanFaqFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { data, isLoading } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY('plans'), () =>
    adminCommercialService.getSettingsSection('plans'),
  );

  useEffect(() => {
    if (!data) return;

    form.setFieldsValue({ planFaqItems: normalizePlanFaqSettings(data.plansFaqItems) });
  }, [data, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await adminCommercialService.setAppSettingsBatch({
        updates: [
          {
            key: APP_SETTING_KEYS.plansFaqItems,
            value: normalizePlanFaqSettings(values.planFaqItems),
          },
        ],
      });
      await mutate(ADMIN_SETTINGS_SECTION_SWR_KEY('plans'));
      await mutate(PUBLIC_PLAN_FAQ_SWR_KEY);
      message.success(t('admin.plans.faqSaveSuccess', '套餐常见问题已保存'));
    } catch {
      message.error(t('admin.plans.faqSaveFailed', '保存失败，请检查常见问题内容'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title={t('admin.plans.faqTitle', '套餐页常见问题')}
      extra={
        <Button disabled={isLoading} loading={submitting} type="primary" onClick={handleSave}>
          {t('admin.plans.faqSave', '保存常见问题')}
        </Button>
      }
    >
      <Form disabled={isLoading} form={form} layout="vertical">
        <Form.List name="planFaqItems">
          {(fields, { add, remove }) => (
            <Flexbox gap={8}>
              {fields.map(({ key, name, ...restField }) => (
                <Flexbox horizontal align="center" gap={8} key={key} style={{ flexWrap: 'wrap' }}>
                  <Form.Item {...restField} hidden name={[name, 'id']}>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    noStyle
                    name={[name, 'question']}
                    rules={[{ message: '请填写问题', required: true }]}
                  >
                    <Input placeholder={t('admin.plans.faqQuestion', '问题')} style={{ flex: 1 }} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    noStyle
                    name={[name, 'answer']}
                    rules={[{ message: '请填写答案', required: true }]}
                  >
                    <Input placeholder={t('admin.plans.faqAnswer', '答案')} style={{ flex: 1.8 }} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    noStyle
                    name={[name, 'enabled']}
                    valuePropName="checked"
                  >
                    <Switch size="small" />
                  </Form.Item>
                  <MinusCircleOutlined style={{ color: '#ff4d4f' }} onClick={() => remove(name)} />
                </Flexbox>
              ))}
              <Button
                block
                icon={<PlusOutlined />}
                type="dashed"
                onClick={() => add({ answer: '', enabled: true, id: '', question: '' })}
              >
                {t('admin.plans.faqAdd', '添加常见问题')}
              </Button>
            </Flexbox>
          )}
        </Form.List>
      </Form>
    </Card>
  );
});

AdminPlanFaqCard.displayName = 'AdminPlanFaqCard';

export default AdminPlanFaqCard;
