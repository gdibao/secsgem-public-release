import { useMemo } from 'react';
import useSWR from 'swr';

import { commercialService } from '@/services/commercial';

export const BalanceDisplay = () => {
  const { data } = useSWR(['commercial.getCreditAccountSummary'], () =>
    commercialService.getCreditAccountSummary(),
  );

  const balance = useMemo(() => data?.balance ?? 0, [data]);

  return (
    <div style={{ marginBottom: 16 }}>
      <h3>当前余额</h3>
      <div style={{ fontSize: 32, fontWeight: 'bold' }}>{balance} 算力</div>
    </div>
  );
};
