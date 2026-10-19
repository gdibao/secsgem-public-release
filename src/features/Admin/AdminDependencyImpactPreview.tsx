'use client';

import { type AdminDependencyImpact, type AdminDependencyImpactItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert, Spin, Tag, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const ImpactItems = ({ items }: { items: AdminDependencyImpactItem[] }) => (
  <Flexbox gap={6}>
    {items.map((item) => (
      <Flexbox gap={2} key={item.code}>
        <Flexbox horizontal align="center" gap={6}>
          <Text strong>{item.title}</Text>
          <Tag>{item.count}</Tag>
        </Flexbox>
        {item.details?.length ? (
          <Text type="secondary">{item.details.slice(0, 5).join(', ')}</Text>
        ) : null}
      </Flexbox>
    ))}
  </Flexbox>
);

const AdminDependencyImpactPreview = memo<{
  error?: boolean;
  impact?: AdminDependencyImpact;
  loading?: boolean;
}>(({ error, impact, loading }) => {
  const { t } = useTranslation('subscription');

  if (loading) return <Spin size="small" />;
  if (error) {
    return (
      <Alert
        showIcon
        message={t('admin.impact.loadFailed', '无法加载依赖影响，已阻止继续操作。')}
        type="error"
      />
    );
  }
  if (!impact) return null;
  if (!impact.targetExists) {
    return (
      <Alert
        showIcon
        message={t('admin.impact.targetMissing', '目标已不存在，请刷新页面。')}
        type="error"
      />
    );
  }

  return (
    <Flexbox gap={10}>
      {impact.blocking.length > 0 ? (
        <Alert
          showIcon
          description={<ImpactItems items={impact.blocking} />}
          message={t('admin.impact.blocking', '必须先处理的阻断依赖')}
          type="error"
        />
      ) : (
        <Alert
          showIcon
          message={t('admin.impact.noBlocking', '未发现阻断依赖')}
          type="success"
        />
      )}
      {impact.immediateEffects.length > 0 ? (
        <Alert
          showIcon
          description={<ImpactItems items={impact.immediateEffects} />}
          message={t('admin.impact.immediate', '确认后立即发生')}
          type="warning"
        />
      ) : null}
      {impact.liveEffects.length > 0 ? (
        <Alert
          showIcon
          description={<ImpactItems items={impact.liveEffects} />}
          message={t('admin.impact.live', '在线运行影响')}
          type="info"
        />
      ) : null}
    </Flexbox>
  );
});

AdminDependencyImpactPreview.displayName = 'AdminDependencyImpactPreview';

export default AdminDependencyImpactPreview;
