/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsageRecordItem } from '@/types/usage/usageRecord';

import UsageTable from './UsageTable';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  records: [] as UsageRecordItem[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));
vi.mock('@lobehub/icons', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span>{provider}</span>,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/SpendType', () => ({
  default: ({ children, type }: { children?: ReactNode; type: string }) => (
    <span data-testid={`spend-type-${type}`}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Select: ({
    'aria-label': ariaLabel,
    options = [],
    value,
    onChange,
  }: {
    'aria-label'?: string;
    'onChange'?: (value?: string) => void;
    'options'?: Array<{ label: string; value: string }>;
    'value'?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(event) => onChange?.(event.target.value || undefined)}
    >
      <option value="">全部类型</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('antd', () => ({
  DatePicker: Object.assign(({ children }: { children?: ReactNode }) => <div>{children}</div>, {
    RangePicker: () => <div data-testid="usage-date-range" />,
  }),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Select: ({ options = [], ...props }: { options?: Array<{ label: string; value: string }> }) => (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/InlineTable', () => ({
  default: ({
    columns = [],
    dataSource = [],
  }: {
    columns?: Array<{ key: string; title?: ReactNode }>;
    dataSource?: UsageRecordItem[];
  }) => (
    <div data-testid="usage-table">
      {columns.map((column) => (
        <span data-testid="usage-column" key={column.key}>
          {column.title}
        </span>
      ))}
      {dataSource.map((item) => (
        <div data-testid="usage-row" key={item.id}>
          {item.model}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/TablePagination', () => ({
  default: ({
    current,
    onChange,
    pageSize,
  }: {
    current: number;
    onChange: (page: number, size: number) => void;
    pageSize: number;
  }) => (
    <div data-testid="usage-pagination">
      <button onClick={() => onChange(current + 1, pageSize)}>next-page</button>
      <button onClick={() => onChange(1, 10)}>resize</button>
    </div>
  ),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: mocks.records,
    error: undefined,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));

vi.mock('@/libs/swr/keys', () => ({
  statsKeys: { usageLogs: () => ['usage-logs'] },
}));

vi.mock('@/services/usage', () => ({
  usageService: { findByMonth: vi.fn() },
}));

vi.mock('@/utils/format', () => ({
  formatDate: (value: Date) => value.toISOString(),
  formatNumber: (value: number) => String(value),
}));

const makeRecord = (
  id: string,
  model: string,
  type: string,
  createdAt: string,
): UsageRecordItem => ({
  createdAt: new Date(createdAt),
  id,
  model,
  provider: 'test-provider',
  spend: 0.1,
  totalInputTokens: 10,
  totalOutputTokens: 20,
  totalTokens: 30,
  type,
  updatedAt: new Date(createdAt),
  userId: 'user-1',
});

const renderTable = () =>
  render(
    <MemoryRouter>
      <UsageTable dateStrings="2026-07" />
    </MemoryRouter>,
  );

describe('UsageTable', () => {
  beforeEach(() => {
    mocks.records = [
      makeRecord('record-1', 'claude-opus-5', 'chat', '2026-07-02T10:00:00.000Z'),
      makeRecord('record-2', 'gpt-5.4', 'image', '2026-07-03T10:00:00.000Z'),
    ];
  });

  it('exposes upstream usage filters and narrows rows by model search', () => {
    renderTable();

    expect(screen.getByPlaceholderText('搜索模型')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '类型' })).toBeInTheDocument();
    expect(screen.getByTestId('usage-date-range')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();
    expect(screen.getAllByTestId('usage-column').map((item) => item.textContent)).toEqual([
      '时间',
      '类型',
      '触发方式',
      '模型',
      'Token 使用量',
      'Spend',
      '消耗积分',
      '耗时',
    ]);
    expect(screen.getAllByTestId('usage-row')).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('搜索模型'), {
      target: { value: 'claude' },
    });

    expect(screen.getAllByTestId('usage-row')).toHaveLength(1);
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument();
    expect(screen.queryByText('gpt-5.4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    expect(screen.getByPlaceholderText('搜索模型')).toHaveValue('');
    expect(screen.getAllByTestId('usage-row')).toHaveLength(2);
  });

  it('updates page and page size together without losing the requested page', () => {
    mocks.records = Array.from({ length: 12 }, (_, index) =>
      makeRecord(`row-${index + 1}`, `model-${index + 1}`, 'chat', '2026-07-02T10:00:00.000Z'),
    );
    renderTable();

    expect(screen.getAllByTestId('usage-row').map((row) => row.textContent)).toEqual([
      'model-1', 'model-2', 'model-3', 'model-4', 'model-5',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));

    expect(screen.getAllByTestId('usage-row').map((row) => row.textContent)).toEqual([
      'model-6', 'model-7', 'model-8', 'model-9', 'model-10',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'resize' }));

    expect(screen.getAllByTestId('usage-row')).toHaveLength(10);
    expect(screen.getAllByTestId('usage-row')[0]).toHaveTextContent('model-1');
  });
});
