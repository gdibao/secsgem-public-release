import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import BusinessMobileRecordList from './BusinessMobileRecordList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'mobile.error.retry': '重试',
        'mobile.records.close': '关闭详情',
        'mobile.records.details': '记录详情',
        'mobile.records.viewDetails': '查看详情',
      })[key] ?? key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
    title,
  }: {
    'aria-label'?: string;
    'onClick'?: () => void;
    'title'?: string;
  }) => <button aria-label={ariaLabel} title={title} type="button" onClick={onClick} />,
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Skeleton: {
    Button: () => <div data-testid="record-skeleton" />,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  FloatingSheet: ({
    children,
    headerActions,
    open,
    title,
    onOpenChange,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
    open?: boolean;
    title?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div aria-label={title as string} role="dialog">
        {headerActions}
        {children}
        <button aria-label="Dismiss sheet" type="button" onClick={() => onOpenChange?.(false)} />
      </div>
    ) : null,
}));

const record = {
  fields: [{ label: '创建时间', value: '2026-07-18' }],
  id: 'record-1',
  status: '已完成',
  title: '基础版 → 进阶版',
  value: '按年',
};

describe('BusinessMobileRecordList', () => {
  it('opens record details and restores focus after closing', () => {
    render(
      <BusinessMobileRecordList
        emptyDescription="暂无记录"
        records={[record]}
        sheetTitle="套餐变更详情"
      />,
    );

    const trigger = screen.getByRole('button', { name: /基础版 → 进阶版/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '套餐变更详情' })).toBeVisible();
    expect(screen.getByText('创建时间')).toBeVisible();

    const closeButton = screen.getByRole('button', { name: '关闭详情' });
    expect(closeButton).not.toHaveAttribute('title');
    fireEvent.click(closeButton);

    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss sheet' }));
    expect(trigger).toHaveFocus();
  });

  it('shows retry only for an error state', () => {
    const onRetry = vi.fn();
    render(
      <BusinessMobileRecordList
        emptyDescription="暂无记录"
        error="加载失败"
        records={[]}
        sheetTitle="详情"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument();
  });

  it('prioritizes error, renders three loading rows, and supports an empty action', () => {
    const { rerender } = render(
      <BusinessMobileRecordList
        isLoading
        emptyDescription="暂无记录"
        error="加载失败"
        records={[record]}
        sheetTitle="详情"
      />,
    );

    expect(screen.getByText('加载失败')).toBeVisible();
    expect(screen.queryByRole('button', { name: /基础版/ })).not.toBeInTheDocument();

    rerender(
      <BusinessMobileRecordList
        isLoading
        emptyDescription="暂无记录"
        records={[record]}
        sheetTitle="详情"
      />,
    );
    expect(screen.getAllByTestId('record-skeleton')).toHaveLength(3);

    rerender(
      <BusinessMobileRecordList
        emptyAction={<button type="button">下一步</button>}
        emptyDescription="暂无记录"
        records={[]}
        sheetTitle="详情"
      />,
    );
    expect(screen.getByText('暂无记录')).toBeVisible();
    expect(screen.getByRole('button', { name: '下一步' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });
});
