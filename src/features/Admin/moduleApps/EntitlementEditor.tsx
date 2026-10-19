'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const EntitlementEditor = memo<{ disabled?: boolean }>(({ disabled }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox data-testid="admin-module-app-entitlement-editor" gap={12}>
      <h3>{t('moduleApps.admin.entitlements.entitlements')}</h3>
      <Form.List name="entitlements">
        {(fields, { add, remove }) => (
          <Flexbox gap={12}>
            {fields.map((field) => (
              <Flexbox key={field.key} gap={8}>
                <Flexbox horizontal gap={12}>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.plan')}
                    name={[field.name, 'plan']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input placeholder={t('moduleApps.admin.entitlements.planPlaceholder')} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.freeQuotaCredits')}
                    name={[field.name, 'freeQuotaCredits']}
                    style={{ flex: 1 }}
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.discountPercent')}
                    name={[field.name, 'discountPercent']}
                    style={{ flex: 1 }}
                  >
                    <InputNumber max={100} min={0} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Flexbox>
                <Flexbox horizontal gap={24}>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.visible')}
                    name={[field.name, 'visible']}
                    valuePropName="checked"
                  >
                    <Switch disabled={disabled} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.installable')}
                    name={[field.name, 'installable']}
                    valuePropName="checked"
                  >
                    <Switch disabled={disabled} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.entitlements.runnable')}
                    name={[field.name, 'runnable']}
                    valuePropName="checked"
                  >
                    <Switch disabled={disabled} />
                  </Form.Item>
                </Flexbox>
                <Button
                  danger
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    remove(field.name);
                  }}
                >
                  {t('moduleApps.admin.entitlements.remove')}
                </Button>
              </Flexbox>
            ))}
            <Button
              disabled={disabled}
              onClick={() =>
                disabled
                  ? undefined
                  : add({
                      discountPercent: 0,
                      freeQuotaCredits: 0,
                      installable: true,
                      plan: 'pro',
                      runnable: true,
                      visible: true,
                    })
              }
            >
              {t('moduleApps.admin.entitlements.add')}
            </Button>
          </Flexbox>
        )}
      </Form.List>
    </Flexbox>
  );
});

EntitlementEditor.displayName = 'EntitlementEditor';

export default EntitlementEditor;
