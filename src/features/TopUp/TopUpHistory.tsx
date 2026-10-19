import { Table } from 'antd';
import useSWR from 'swr';

import { commercialService } from '@/services/commercial';

const sourceLabels: Record<string, string> = {
  alipay: '支付宝',
  manual: '手动充值',
  redemption: '卡密兑换',
  wechat_pay: '微信支付',
  zpay: '第三方支付',
};

const statusLabels: Record<string, string> = {
  canceled: '已取消',
  expired: '已过期',
  failed: '失败',
  paid: '已支付',
  pending: '待支付',
  refunded: '已退款',
};

export const TopUpHistory = () => {
  const { data } = useSWR(['commercial.listTopUpOrders'], () =>
    commercialService.listTopUpOrders({ limit: 20 }),
  );

  const columns = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: Date) => new Date(v).toLocaleString(),
      title: '时间',
    },
    { dataIndex: 'credits', key: 'credits', title: '算力' },
    {
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => sourceLabels[v] ?? v,
      title: '来源',
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => statusLabels[v] ?? v,
      title: '状态',
    },
  ];

  return (
    <div>
      <h3>充值记录</h3>
      <Table
        columns={columns}
        dataSource={data ?? []}
        pagination={false}
        rowKey="id"
        size="small"
      />
    </div>
  );
};
