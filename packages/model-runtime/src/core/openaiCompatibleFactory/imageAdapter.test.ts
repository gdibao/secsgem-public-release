import { describe, expect, it } from 'vitest';

import { sanitizeImageOptions } from './imageAdapter';

describe('openai compatible image adapter', () => {
  it('sanitizes gpt-image-2 snapshot options', () => {
    const result = sanitizeImageOptions('gpt-image-2-2026-04-21', {
      model: 'gpt-image-2-2026-04-21',
      n: 1,
      prompt: 'draw',
      response_format: 'b64_json',
      size: 'auto',
      style: 'vivid',
    });

    expect(result).toEqual({
      model: 'gpt-image-2-2026-04-21',
      n: 1,
      prompt: 'draw',
      size: '1024x1024',
    });
  });

  it('maps Nano Banana options to compatible upstream field names', () => {
    const result = sanitizeImageOptions('gemini-3.1-flash-image-preview', {
      aspectRatio: '16:9',
      model: 'gemini-3.1-flash-image-preview',
      n: 1,
      prompt: 'draw',
      resolution: '4K',
    });

    expect(result).toEqual({
      aspect_ratio: '16:9',
      image_size: '4K',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'draw',
    });
  });

  it('leaves unknown image models unchanged', () => {
    const options = {
      model: 'custom-image-model',
      n: 1,
      prompt: 'draw',
      size: '1024x1024',
    };

    expect(sanitizeImageOptions('custom-image-model', options)).toBe(options);
  });

  it('only applies qwen-image-edit strict params to edit operations', () => {
    const generateOptions = {
      model: 'qwen-image-edit',
      n: 1,
      prompt: 'draw',
      size: '1024x1024',
    };

    expect(sanitizeImageOptions('qwen-image-edit', generateOptions, 'generate')).toBe(
      generateOptions,
    );

    expect(
      sanitizeImageOptions(
        'qwen-image-edit',
        {
          image: 'file',
          input_fidelity: 'high',
          model: 'qwen-image-edit',
          n: 1,
          prompt: 'edit',
          size: '1024x1024',
        },
        'edit',
      ),
    ).toEqual({
      image: 'file',
      model: 'qwen-image-edit',
      prompt: 'edit',
    });
  });
});
