'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const RUNTIME_TYPES = [
  'none',
  'record_create',
  'record_update',
  'record_archive',
  'api_action',
  'server_action',
  'content_generation',
  'workflow_step',
  'executable_action',
] as const;

const ActionEditor = memo<{ disabled?: boolean }>(({ disabled }) => {
  const { t } = useTranslation('common');
  const runtimeTypeOptions = RUNTIME_TYPES.map((value) => ({
    label: t(`moduleApps.admin.configuration.runtimeTypeOptions.${value}`),
    value,
  }));

  return (
    <Flexbox data-testid="admin-module-app-action-editor" gap={12}>
      <h3>{t('moduleApps.admin.configuration.actions')}</h3>
      <Form.List name="actions">
        {(fields, { add, remove }) => (
          <Flexbox gap={12}>
            {fields.map((field, index) => (
              <Flexbox key={field.key} gap={8}>
                <Flexbox horizontal gap={12}>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.actionId')}
                    name={[field.name, 'id']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input placeholder={t('moduleApps.admin.configuration.actionIdPlaceholder')} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.actionName')}
                    name={[field.name, 'name']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input
                      placeholder={t('moduleApps.admin.configuration.actionNamePlaceholder', {
                        index: index + 1,
                      })}
                    />
                  </Form.Item>
                </Flexbox>
                <Flexbox horizontal gap={12}>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.runtimeType')}
                    name={[field.name, 'runtimeType']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Select options={runtimeTypeOptions} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.moduleMultiplier')}
                    name={[field.name, 'moduleMultiplier']}
                    style={{ width: 180 }}
                  >
                    <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                  </Form.Item>
                </Flexbox>
                <Form.Item
                  label={t('moduleApps.admin.configuration.inputSchemaJson')}
                  name={[field.name, 'inputSchemaJson']}
                >
                  <Input.TextArea
                    autoSize={{ maxRows: 5, minRows: 2 }}
                    placeholder={'{\n  "fields": []\n}'}
                  />
                </Form.Item>
                <Form.Item
                  label={t('moduleApps.admin.configuration.outputSchemaJson')}
                  name={[field.name, 'outputSchemaJson']}
                >
                  <Input.TextArea autoSize={{ maxRows: 5, minRows: 2 }} placeholder="{}" />
                </Form.Item>
                <Form.Item
                  label={t('moduleApps.admin.configuration.runtimeConfigJson')}
                  name={[field.name, 'runtimeConfigJson']}
                >
                  <Input.TextArea autoSize={{ maxRows: 5, minRows: 2 }} placeholder="{}" />
                </Form.Item>
                <Button
                  danger
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    remove(field.name);
                  }}
                >
                  {t('moduleApps.admin.configuration.removeAction')}
                </Button>
              </Flexbox>
            ))}
            <Button
              disabled={disabled}
              onClick={() =>
                disabled
                  ? undefined
                  : add({
                      id: 'create_record',
                      inputSchemaJson: '{\n  "fields": []\n}',
                      moduleMultiplier: 1,
                      name: t('moduleApps.admin.configuration.newActionName'),
                      outputSchemaJson: '{}',
                      runtimeConfigJson: '{}',
                      runtimeType: 'record_create',
                    })
              }
            >
              {t('moduleApps.admin.configuration.addAction')}
            </Button>
          </Flexbox>
        )}
      </Form.List>
    </Flexbox>
  );
});

ActionEditor.displayName = 'ActionEditor';

export default ActionEditor;
