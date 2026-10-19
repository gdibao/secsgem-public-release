import { describe, expect, it } from 'vitest';

import { replaceLegacyBrandTokens } from './brandText';

describe('replaceLegacyBrandTokens', () => {
  it('replaces legacy Lobe brand spellings with the configured brand name', () => {
    expect(replaceLegacyBrandTokens('为 LobeAI 添加渠道', '驰拓AI')).toBe('为 驰拓AI 添加渠道');
    expect(replaceLegacyBrandTokens('Ask Lobe AI', '驰拓AI')).toBe('Ask 驰拓AI');
    expect(replaceLegacyBrandTokens('LobeHub Skills', '驰拓AI')).toBe('驰拓AI Skills');
    expect(replaceLegacyBrandTokens('玄果 AI / QingyouAI', '驰拓AI')).toBe('驰拓AI / 驰拓AI');
  });
});
