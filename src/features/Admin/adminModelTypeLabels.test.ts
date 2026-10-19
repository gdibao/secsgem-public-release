import { describe, expect, it } from 'vitest';

import { getAdminModelTypeLabel } from './adminModelTypeLabels';

describe('adminModelTypeLabels', () => {
  it('uses Chinese labels for built-in model types', () => {
    expect(getAdminModelTypeLabel('chat')).toBe('对话');
    expect(getAdminModelTypeLabel('embedding')).toBe('向量');
    expect(getAdminModelTypeLabel('tts')).toBe('文字转语音');
    expect(getAdminModelTypeLabel('stt')).toBe('语音转文字');
    expect(getAdminModelTypeLabel('text2music')).toBe('文生音乐');
  });

  it('keeps unknown technical model types visible', () => {
    expect(getAdminModelTypeLabel('custom-type')).toBe('custom-type');
  });
});
