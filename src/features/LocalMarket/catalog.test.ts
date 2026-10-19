import { describe, expect, it } from 'vitest';

import { localMcpItems } from './catalog';

describe('Fab local MCP catalog', () => {
  it('exposes the built-in knowledge and sandbox entries as agent actions', () => {
    expect(localMcpItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fab-offline-knowledge',
          installable: true,
          sourceId: 'fab-offline-knowledge',
        }),
        expect.objectContaining({
          id: 'fab-local-sandbox',
          installable: true,
          sourceId: 'lobe-cloud-sandbox',
        }),
      ]),
    );
  });
});
