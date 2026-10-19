import { describe, expect, it } from 'vitest';
import { DEFAULT_COMHUB_AGENT_AVATAR, resolveDefaultAgentAvatar } from './defaultAgent';

describe('product default avatar', () => {
  it('maps only the exact built-in legacy asset', () => {
    expect(resolveDefaultAgentAvatar('/avatars/lobe-ai.png')).toBe(DEFAULT_COMHUB_AGENT_AVATAR);
  });
  it.each(['https://example.com/lobe-ai.png', '/uploads/my-logo.png', '🤖', null, undefined])(
    'preserves custom or absent avatar %s',
    (avatar) => {
      expect(resolveDefaultAgentAvatar(avatar)).toBe(avatar);
    },
  );
});
