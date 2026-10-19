import { type ErrorType } from '@lobechat/types';
import { type AlertProps } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import React from 'react';

const ERROR_CONFIGS: Partial<Record<ErrorType, AlertProps>> = {
  InsufficientBudgetForModel: {
    action: React.createElement(
      Button,
      {
        onClick: () => {
          window.location.hash = '/topup';
        },
        size: 'small',
        type: 'primary',
      },
      '去充值',
    ),
    message: '余额不足，请充值后继续使用',
    type: 'warning',
  },
  StorageQuotaExceeded: {
    message: '存储空间不足，请清理文件或升级套餐',
    type: 'warning',
  },
  VectorQuotaExceeded: {
    message: '向量数据库条数不足，请清理文件或升级套餐',
    type: 'warning',
  },
};

export default function useBusinessErrorAlertConfig(errorType?: ErrorType): AlertProps | undefined {
  if (!errorType) return undefined;
  return ERROR_CONFIGS[errorType];
}
