import { describe, expect, it } from 'vitest';

import {
  MATRIX_ACCESS_SAVE_LABEL,
  MATRIX_DISCARD_LABEL,
  MATRIX_PRICING_SAVE_LABEL,
  MATRIX_SUBTITLE,
} from './adminMatrixCopy';

describe('adminMatrixCopy', () => {
  it('names matrix save actions by their actual scope', () => {
    expect(MATRIX_ACCESS_SAVE_LABEL).toBe('保存套餐权限');
    expect(MATRIX_PRICING_SAVE_LABEL).toBe('保存模型计费');
    expect(MATRIX_PRICING_SAVE_LABEL).not.toBe('保存计费规则');
  });

  it('explains that global billing settings are edited in the matrix', () => {
    expect(MATRIX_SUBTITLE).toContain('模型级计费');
    expect(MATRIX_SUBTITLE).toContain('全局计费基线');
    expect(MATRIX_SUBTITLE).not.toContain('站点设置');
    expect(MATRIX_DISCARD_LABEL).toBe('放弃本页未保存调整');
  });
});
