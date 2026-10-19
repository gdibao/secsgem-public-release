import { ADMIN_BASE_PATH } from './adminNavigation';

export const ADMIN_OVERVIEW_QUICK_LINKS = [
  {
    key: 'providers',
    label: '服务商实例',
    path: `${ADMIN_BASE_PATH}/providers`,
  },
  {
    key: 'matrix',
    label: '模型与计费矩阵',
    path: `${ADMIN_BASE_PATH}/model-billing-matrix`,
  },
  {
    key: 'plans',
    label: '套餐管理',
    path: `${ADMIN_BASE_PATH}/plans`,
  },
  {
    key: 'stats',
    label: '数据看板',
    path: `${ADMIN_BASE_PATH}/stats`,
  },
] as const;
