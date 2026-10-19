import { describe, expect, it, vi } from 'vitest';

import { aggregateMobileRecentDesignItems } from './mobileDesign';

const date = (hour: number) => new Date(`2026-07-19T${String(hour).padStart(2, '0')}:00:00.000Z`);

describe('aggregateMobileRecentDesignItems', () => {
  it('merges domain records by update time and builds existing editor routes', async () => {
    const result = await aggregateMobileRecentDesignItems(
      {
        documents: vi.fn().mockResolvedValue([{ id: 'doc-1', title: '', updatedAt: date(8) }]),
        images: vi.fn().mockResolvedValue([{ id: 'image-1', title: null, updatedAt: date(10) }]),
        ppts: vi.fn().mockResolvedValue([
          {
            id: 'ppt-1',
            status: 'generated',
            title: 'Launch deck',
            updatedAt: date(9),
            upstreamTaskId: 'upstream/ppt-1',
          },
        ]),
      },
      10,
    );

    expect(result).toEqual([
      {
        id: 'image-1',
        kind: 'image',
        routePath: '/image?topic=image-1',
        title: 'Untitled image',
        updatedAt: date(10),
      },
      {
        id: 'ppt-1',
        kind: 'ppt',
        resumeSupported: true,
        routePath: '/ppt?recordId=ppt-1',
        status: 'generated',
        title: 'Launch deck',
        updatedAt: date(9),
      },
      {
        id: 'doc-1',
        kind: 'document',
        routePath: '/page/doc-1',
        title: 'Untitled document',
        updatedAt: date(8),
      },
    ]);
  });

  it('marks PPT rows without upstream identity as an explicit new-workspace action', async () => {
    const [result] = await aggregateMobileRecentDesignItems(
      {
        documents: vi.fn().mockResolvedValue([]),
        images: vi.fn().mockResolvedValue([]),
        ppts: vi
          .fn()
          .mockResolvedValue([
            { id: 'ppt-no-resume', status: 'editing', title: 'Draft', updatedAt: date(9) },
          ]),
      },
      10,
    );

    expect(result).toMatchObject({
      id: 'ppt-no-resume',
      kind: 'ppt',
      resumeSupported: false,
      routePath: '/ppt',
    });
  });

  it('keeps permitted domains when another domain rejects and applies the aggregate limit last', async () => {
    const documents = vi.fn().mockRejectedValue(new Error('forbidden'));
    const images = vi.fn().mockResolvedValue([
      { id: 'image-1', title: 'Newest', updatedAt: date(12) },
      { id: 'image-2', title: 'Older', updatedAt: date(8) },
    ]);
    const ppts = vi
      .fn()
      .mockResolvedValue([
        { id: 'ppt-1', status: 'editing', title: 'Middle', updatedAt: date(10) },
      ]);

    const result = await aggregateMobileRecentDesignItems({ documents, images, ppts }, 2);

    expect(result.map((item) => item.id)).toEqual(['image-1', 'ppt-1']);
    expect(documents).toHaveBeenCalledWith(2);
    expect(images).toHaveBeenCalledWith(2);
    expect(ppts).toHaveBeenCalledWith(2);
  });

  it('surfaces an error when every authoritative domain fails', async () => {
    const failed = () => vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      aggregateMobileRecentDesignItems(
        { documents: failed(), images: failed(), ppts: failed() },
        10,
      ),
    ).rejects.toThrow('Unable to load recent design work');
  });
});
