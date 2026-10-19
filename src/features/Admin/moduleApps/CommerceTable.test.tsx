import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CommerceTable from './CommerceTable';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Modal: (props: any) =>
    props.open ? (
      <div role="dialog">
        {props.children}
        <button disabled={props.okButtonProps?.disabled} type="button" onClick={props.onOk}>
          {props.okText}
        </button>
      </div>
    ) : null,
}));

describe('module app commerce table', () => {
  it('settles only selected pending accrual entries', async () => {
    const onSettle = vi.fn().mockResolvedValue(undefined);

    render(
      <CommerceTable
        items={[
          {
            appId: 'app-1',
            currency: 'CNY',
            developerAmount: 7200,
            grossAmount: 10_000,
            id: 'entry-1',
            orderId: 'order-1',
            platformFee: 2000,
            reserveAmount: 800,
            status: 'pending',
            type: 'accrual',
          },
          {
            appId: 'app-1',
            currency: 'CNY',
            developerAmount: -7200,
            grossAmount: -10_000,
            id: 'entry-2',
            orderId: 'order-1',
            platformFee: -2000,
            reserveAmount: -800,
            status: 'reversed',
            type: 'reversal',
          },
        ]}
        onSettle={onSettle}
      />,
    );

    expect(screen.getAllByText('order-1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Settle selected' })).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[1]).toBeDisabled();
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Settle selected' }));
    expect(screen.getByText(/1.*CNY 7,200/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }));

    await waitFor(() => expect(onSettle).toHaveBeenCalledWith(['entry-1']));
  });

  it('hides settlement controls for read-only finance users', () => {
    render(
      <CommerceTable
        canWrite={false}
        items={[
          {
            appId: 'app-1',
            currency: 'CNY',
            developerAmount: 10,
            grossAmount: 10,
            id: 'entry-1',
            orderId: 'order-1',
            platformFee: 0,
            reserveAmount: 0,
            status: 'pending',
            type: 'accrual',
          },
        ]}
        onSettle={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Settle selected' })).not.toBeInTheDocument();
  });

  it('uses supplied localized labels for actions and statuses', () => {
    render(
      <CommerceTable
        items={[]}
        labels={{
          description: '仅商品收入',
          developer: '开发者',
          gross: '总额',
          platformFee: '平台费',
          reserve: '准备金',
          select: '选择收入',
          settle: '结算选中项',
          status: '状态',
          type: '类型',
        }}
        onSettle={vi.fn()}
      />,
    );

    expect(screen.getByText('仅商品收入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结算选中项' })).toBeInTheDocument();
  });
});
