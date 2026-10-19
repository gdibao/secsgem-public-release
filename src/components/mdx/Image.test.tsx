import { getPlaiceholder } from 'plaiceholder';
import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImageWrapper from './Image';

vi.mock('plaiceholder', () => ({
  getPlaiceholder: vi.fn(),
}));

describe('ImageWrapper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the generated placeholder as a wrapper background', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }),
    );
    vi.mocked(getPlaiceholder).mockResolvedValue({
      base64: 'data:image/webp;base64,cGxhY2Vob2xkZXI=',
      metadata: { height: 300, width: 400 },
    } as Awaited<ReturnType<typeof getPlaiceholder>>);

    const image = await ImageWrapper({ alt: 'Preview', src: 'https://example.com/image.png' });

    expect(isValidElement(image)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(image))
      throw new Error('Expected an image element');

    expect(image).toMatchObject({
      props: {
        alt: 'Preview',
        height: 600,
        src: 'https://example.com/image.png',
        styles: {
          wrapper: {
            backgroundImage: 'url("data:image/webp;base64,cGxhY2Vob2xkZXI=")',
          },
        },
        width: 800,
      },
    });
    expect(image.props).not.toHaveProperty('placeholder');
  });
});
