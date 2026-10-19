import { describe, expect, it } from 'vitest';

import {
  GLOBAL_MODEL_POLICY_DENIED_MESSAGE,
  GLOBAL_MODEL_POLICY_HELP_TEXT,
  MODEL_POLICY_MATRIX_PATH,
} from './adminModelPolicySettings';
import { ADMIN_BASE_PATH } from './adminNavigation';

describe('adminModelPolicySettings', () => {
  it('separates global model policy wording from plan model permissions', () => {
    expect(GLOBAL_MODEL_POLICY_HELP_TEXT).toContain('全局模型访问策略');
    expect(GLOBAL_MODEL_POLICY_HELP_TEXT).toContain('模型与计费矩阵');
    expect(GLOBAL_MODEL_POLICY_DENIED_MESSAGE).toContain('全局模型访问策略');
    expect(GLOBAL_MODEL_POLICY_DENIED_MESSAGE).not.toContain('套餐');
  });

  it('points related model commercial configuration to the matrix', () => {
    expect(MODEL_POLICY_MATRIX_PATH).toBe(`${ADMIN_BASE_PATH}/model-billing-matrix`);
  });
});
