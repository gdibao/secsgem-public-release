import { describe, expect, it } from 'vitest';

import { resolveImageRouteMode } from './imageRoute';

describe('openai compatible image route', () => {
  it('routes :image suffix models to chat-image mode', () => {
    expect(resolveImageRouteMode('gemini-3.1-flash-image-preview:image')).toBe('chat-image');
  });

  it('routes image API models to openai-images mode', () => {
    expect(resolveImageRouteMode('gpt-image-2')).toBe('openai-images');
  });

  it('routes async task image models to async-image-task mode', () => {
    expect(resolveImageRouteMode('jimeng-image-async')).toBe('async-image-task');
  });

  it('routes image models with async params to async-image-task mode', () => {
    expect(resolveImageRouteMode('jimeng-image', { async: true })).toBe('async-image-task');
  });
});
