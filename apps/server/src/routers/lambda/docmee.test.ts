import { describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  createToken: vi.fn().mockResolvedValue({ sessionId: 's1', token: 'token-1' }),
  getRuntime: vi.fn().mockResolvedValue({ enabled: true }),
  reportEvent: vi.fn().mockResolvedValue({ charged: true }),
}));

vi.mock('@/server/services/docmee', () => ({
  DocmeePptError: class DocmeePptError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  DocmeePptService: vi.fn(() => serviceMocks),
}));

const { docmeeRouter } = await import('./docmee');

describe('docmeeRouter', () => {
  it('creates a PPT token for the authenticated user', async () => {
    const caller = docmeeRouter.createCaller({ serverDB: {}, userId: 'u1' } as any);

    await expect(caller.createPptToken()).resolves.toEqual({ sessionId: 's1', token: 'token-1' });
    expect(serviceMocks.createToken).toHaveBeenCalledWith(undefined);
  });

  it('resolves a saved PPT through its user-scoped local record', async () => {
    const caller = docmeeRouter.createCaller({ serverDB: {}, userId: 'u1' } as any);
    const recordId = '00000000-0000-4000-8000-000000000001';

    await caller.createPptToken({ recordId });

    expect(serviceMocks.createToken).toHaveBeenCalledWith(recordId);
  });

  it('reports PPT lifecycle events', async () => {
    const caller = docmeeRouter.createCaller({ serverDB: {}, userId: 'u1' } as any);

    await caller.reportPptEvent({ data: null, sessionId: 's1', type: 'afterGenerate' });

    expect(serviceMocks.reportEvent).toHaveBeenCalledWith({
      data: null,
      sessionId: 's1',
      type: 'afterGenerate',
    });
  });
});
