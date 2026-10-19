import { ADMIN_BASE_PATH } from './adminNavigation';

export const MODEL_POLICY_MATRIX_PATH = `${ADMIN_BASE_PATH}/model-billing-matrix`;

export const GLOBAL_MODEL_POLICY_HELP_TEXT =
  '全局模型访问策略会在每次 AI 请求前执行，适合作为平台级允许/禁用清单。套餐权限、默认模型和模型计费请在“模型与计费矩阵”维护。';

export const GLOBAL_MODEL_POLICY_DENIED_MESSAGE =
  '当前模型未通过全局模型访问策略，请联系管理员调整可用模型。';
