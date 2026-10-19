'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_TYPES = ['overview', 'form', 'list', 'detail', 'result', 'artifact', 'custom'] as const;

const PageEditor = memo<{ disabled?: boolean }>(({ disabled }) => {
  const { t } = useTranslation('common');
  const pageTypeOptions = PAGE_TYPES.map((value) => ({
    label: t(`moduleApps.admin.configuration.pageTypeOptions.${value}`),
    value,
  }));

  return (
    <Flexbox data-testid="admin-module-app-page-editor" gap={12}>
      <h3>{t('moduleApps.admin.configuration.pages')}</h3>
      <Form.List name="pages">
        {(fields, { add, remove }) => (
          <Flexbox gap={12}>
            {fields.map((field, index) => (
              <Flexbox key={field.key} gap={8}>
                <Flexbox horizontal gap={12}>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.pageKey')}
                    name={[field.name, 'key']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input placeholder={t('moduleApps.admin.configuration.pageKeyPlaceholder')} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.pageTitle')}
                    name={[field.name, 'title']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input
                      placeholder={t('moduleApps.admin.configuration.pageTitlePlaceholder', {
                        index: index + 1,
                      })}
                    />
                  </Form.Item>
                </Flexbox>
                <Flexbox horizontal gap={12}>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.pageType')}
                    name={[field.name, 'type']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Select options={pageTypeOptions} />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.routePath')}
                    name={[field.name, 'routePath']}
                    rules={[{ required: true }]}
                    style={{ flex: 1 }}
                  >
                    <Input placeholder="/" />
                  </Form.Item>
                  <Form.Item
                    label={t('moduleApps.admin.configuration.sortOrder')}
                    name={[field.name, 'sortOrder']}
                    style={{ width: 140 }}
                  >
                    <InputNumber precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Flexbox>
                <Form.Item
                  label={t('moduleApps.admin.configuration.dataSourceJson')}
                  name={[field.name, 'dataSourceJson']}
                >
                  <Input.TextArea
                    autoSize={{ maxRows: 5, minRows: 2 }}
                    placeholder={'{\n  "collectionKey": "records"\n}'}
                  />
                </Form.Item>
                <Form.Item
                  label={t('moduleApps.admin.configuration.layoutSchemaJson')}
                  name={[field.name, 'layoutSchemaJson']}
                >
                  <Input.TextArea autoSize={{ maxRows: 5, minRows: 2 }} placeholder="{}" />
                </Form.Item>
                <Form.Item
                  label={t('moduleApps.admin.configuration.actionBindingsJson')}
                  name={[field.name, 'actionBindingsJson']}
                >
                  <Input.TextArea
                    autoSize={{ maxRows: 5, minRows: 2 }}
                    placeholder={'[{ "event": "submit", "actionKey": "create_record" }]'}
                  />
                </Form.Item>
                <Button
                  danger
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    remove(field.name);
                  }}
                >
                  {t('moduleApps.admin.configuration.removePage')}
                </Button>
              </Flexbox>
            ))}
            <Button
              disabled={disabled}
              onClick={() =>
                disabled
                  ? undefined
                  : add({
                      key: 'overview',
                      routePath: '/',
                      title: t('moduleApps.admin.configuration.newPageTitle'),
                      type: 'overview',
                    })
              }
            >
              {t('moduleApps.admin.configuration.addPage')}
            </Button>
          </Flexbox>
        )}
      </Form.List>
    </Flexbox>
  );
});

PageEditor.displayName = 'PageEditor';

export default PageEditor;
