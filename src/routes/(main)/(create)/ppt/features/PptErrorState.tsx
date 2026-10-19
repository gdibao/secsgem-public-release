'use client';

import { Button, Result } from 'antd';
import { memo } from 'react';
import { useNavigate } from 'react-router';

const copy: Record<string, { action?: string; description: string; title: string }> = {
  PPT_DISABLED: {
    description: '管理员暂未开启 PPT 创作功能。',
    title: 'PPT 创作暂未开启',
  },
  PPT_FORBIDDEN_BY_PLAN: {
    action: '查看套餐',
    description: '当前套餐暂不支持 PPT 创作，可以升级套餐或使用激活码。',
    title: '当前套餐不可用',
  },
  PPT_NOT_CONFIGURED: {
    description: '管理员尚未配置 Docmee PPT 服务。',
    title: 'PPT 服务未配置',
  },
  PPT_QUOTA_EXHAUSTED: {
    action: '查看套餐',
    description: '本月 PPT 生成额度已用完，可以升级套餐或等待下个周期。',
    title: 'PPT 额度不足',
  },
  PPT_UPSTREAM_TOKEN_FAILED: {
    description: 'Docmee 服务暂时不可用，请稍后重试。',
    title: '服务连接失败',
  },
};

const PptErrorState = memo<{ code?: string; onRetry?: () => void }>(({ code, onRetry }) => {
  const navigate = useNavigate();
  const item = copy[code || ''] ?? {
    description: '请稍后重试。',
    title: 'PPT 创作加载失败',
  };

  return (
    <Result
      status="warning"
      subTitle={item.description}
      title={item.title}
      extra={
        item.action ? (
          <Button type="primary" onClick={() => navigate('/settings/plans')}>
            {item.action}
          </Button>
        ) : (
          <Button onClick={onRetry}>重试</Button>
        )
      }
    />
  );
});

PptErrorState.displayName = 'PptErrorState';

export default PptErrorState;
