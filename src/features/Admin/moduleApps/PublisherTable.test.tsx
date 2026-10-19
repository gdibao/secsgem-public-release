import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PublisherTable from './PublisherTable';

describe('PublisherTable', () => {
  it('renders publisher identity and masked Alipay recipient', () => {
    render(
      <PublisherTable
        items={[
          {
            appCount: 3,
            displayName: 'Verified Studio',
            id: 'publisher-1',
            recipientMask: 'ali***@example.com',
            status: 'verified',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('Verified Studio')).toBeInTheDocument();
    expect(screen.getByText('ali***@example.com')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders a stable empty state', () => {
    render(<PublisherTable items={[]} />);
    expect(screen.getByText('No publishers')).toBeInTheDocument();
    expect(screen.queryByLabelText('Next page')).toBeNull();
  });

  it('supports localized columns, status labels, actions, and one pager', () => {
    const onNext = vi.fn();
    render(
      <PublisherTable
        hasNext
        renderActions={() => <button type="button">审核</button>}
        items={[
          {
            appCount: 1,
            displayName: 'Studio',
            id: 'publisher-1',
            status: 'pending',
            userId: 'user-1',
          },
        ]}
        labels={{
          columns: {
            apps: '应用数',
            id: '标识',
            owner: '所有者',
            publisher: '发布方',
            recipient: '收款人',
            status: '状态',
          },
          empty: '暂无发布方',
          loading: '正在加载发布方',
          next: '下一页',
          previous: '上一页',
          retry: '重试',
          status: { pending: '待处理' },
        }}
        onNext={onNext}
      />,
    );

    expect(screen.getAllByText('发布方')[0]).toBeInTheDocument();
    expect(screen.getByText('待处理')).toBeInTheDocument();
    expect(screen.queryByText('pending')).toBeNull();
    expect(screen.getByRole('button', { name: '审核' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('下一页')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('下一页'));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
