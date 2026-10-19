'use client';

import { AutoComplete, Form, type FormInstance, Input } from 'antd';
import { memo, type ReactNode } from 'react';

import {
  type DefaultModelOption,
  resolveModelProviderLabel,
} from '@/features/Admin/adminSettingsForm';

import { AdminFormGrid } from '../layout';

export interface RuntimeModelFieldPairProps {
  extra?: ReactNode;
  form: FormInstance;
  modelField: string;
  modelLabel: string;
  options: DefaultModelOption[];
  placeholder: string;
  providerField: string;
  providerLabel?: string;
}

const RuntimeModelFieldPair = memo<RuntimeModelFieldPairProps>(
  ({
    extra,
    form,
    modelField,
    modelLabel,
    options,
    placeholder,
    providerField,
    providerLabel = '供应商',
  }) => {
    const model = Form.useWatch(modelField, form) as string | undefined;
    const provider = Form.useWatch(providerField, form) as string | undefined;
    const displayProvider = resolveModelProviderLabel({ model, provider }, options);

    return (
      <AdminFormGrid label={`${modelLabel}与${providerLabel}`}>
        <Form.Item extra={extra} label={modelLabel} name={modelField}>
          <AutoComplete
            allowClear
            options={options}
            placeholder={placeholder}
            onChange={(value) => {
              const selected = options.find((option) => option.value === value);
              if (!selected) return form.setFieldValue(providerField, '');

              form.setFieldsValue({
                [modelField]: selected.model,
                [providerField]: selected.provider,
              });
            }}
            onSelect={(value) => {
              const selected = options.find((option) => option.value === value);
              if (!selected) return;

              form.setFieldsValue({
                [modelField]: selected.model,
                [providerField]: selected.provider,
              });
            }}
          />
        </Form.Item>
        <Form.Item hidden name={providerField}>
          <Input />
        </Form.Item>
        <Form.Item label={providerLabel}>
          <Input
            readOnly
            aria-label={providerLabel}
            placeholder="选择模型后自动显示"
            value={displayProvider}
          />
        </Form.Item>
      </AdminFormGrid>
    );
  },
);

RuntimeModelFieldPair.displayName = 'RuntimeModelFieldPair';

export default RuntimeModelFieldPair;
