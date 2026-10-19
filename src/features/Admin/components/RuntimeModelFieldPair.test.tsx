import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Form, type FormInstance } from 'antd';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DefaultModelOption } from '../adminSettingsForm';
import RuntimeModelFieldPair from './RuntimeModelFieldPair';

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  type AutoCompleteProps = Omit<ComponentProps<'select'>, 'onChange'> & {
    allowClear?: boolean;
    onChange?: (value: string) => void;
    onSelect?: (value: string) => void;
    options?: Array<{ label: ReactNode; value: string }>;
  };

  return {
    ...actual,
    AutoComplete: ({
      allowClear: _allowClear,
      onChange,
      onSelect,
      options = [],
      ...props
    }: AutoCompleteProps) => (
      <select
        {...props}
        onChange={(event) => {
          const value = event.target.value;
          if (value) onSelect?.(value);
          onChange?.(value);
        }}
      >
        <option value="">Clear</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

type Fields = {
  memoryGatekeeperModel: string;
  memoryGatekeeperProvider: string;
};

const options: DefaultModelOption[] = [
  {
    label: 'DeepSeek V4 Pro (opencode-go / OpenCode Go / chat)',
    model: 'deepseek-v4-pro',
    provider: 'provider-1',
    providerLabel: 'opencode-go / OpenCode Go',
    value: 'provider-1:deepseek-v4-pro',
  },
];

const renderField = (initialValues: Fields) => {
  let form: FormInstance<Fields> | undefined;

  const Harness = () => {
    const [instance] = Form.useForm<Fields>();
    form = instance;

    return (
      <Form form={instance} initialValues={initialValues}>
        <RuntimeModelFieldPair
          form={instance}
          modelField="memoryGatekeeperModel"
          modelLabel="记忆判定模型"
          options={options}
          placeholder="选择聊天模型"
          providerField="memoryGatekeeperProvider"
        />
      </Form>
    );
  };

  render(<Harness />);

  return () => {
    if (!form) throw new Error('FORM_NOT_READY');
    return form;
  };
};

describe('RuntimeModelFieldPair', () => {
  it('shows the resolved provider as read-only text', () => {
    renderField({
      memoryGatekeeperModel: 'deepseek-v4-pro',
      memoryGatekeeperProvider: 'provider-1',
    });

    expect(screen.getByLabelText('供应商')).toHaveValue('opencode-go / OpenCode Go');
    expect(screen.getByLabelText('供应商')).toHaveAttribute('readonly');
  });

  it('writes the selected raw pair and clears both fields together', async () => {
    const getForm = renderField({
      memoryGatekeeperModel: '',
      memoryGatekeeperProvider: '',
    });
    const model = screen.getByLabelText('记忆判定模型');

    fireEvent.change(model, { target: { value: 'provider-1:deepseek-v4-pro' } });

    await waitFor(() => {
      expect(getForm().getFieldsValue()).toMatchObject({
        memoryGatekeeperModel: 'deepseek-v4-pro',
        memoryGatekeeperProvider: 'provider-1',
      });
    });

    expect(screen.getByLabelText('供应商')).toHaveValue('opencode-go / OpenCode Go');

    fireEvent.change(model, { target: { value: '' } });

    await waitFor(() => {
      expect(getForm().getFieldsValue()).toMatchObject({
        memoryGatekeeperModel: '',
        memoryGatekeeperProvider: '',
      });
    });
  });
});
