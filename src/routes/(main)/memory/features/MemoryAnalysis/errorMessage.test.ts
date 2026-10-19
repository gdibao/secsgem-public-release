import { describe, expect, it } from 'vitest';

import { getMemoryAnalysisErrorMessage } from './errorMessage';

describe('getMemoryAnalysisErrorMessage', () => {
  it('appends useful server error details after the generic failure copy', () => {
    expect(
      getMemoryAnalysisErrorMessage(
        new Error('QSTASH_TOKEN is not configured'),
        '记忆分析请求失败',
      ),
    ).toBe('记忆分析请求失败：QSTASH_TOKEN is not configured');
  });

  it('keeps the generic failure copy when the error has no message', () => {
    expect(getMemoryAnalysisErrorMessage({}, '记忆分析请求失败')).toBe('记忆分析请求失败');
  });
});
