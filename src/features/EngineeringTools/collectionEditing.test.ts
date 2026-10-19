import { describe, expect, it } from 'vitest';

import { collectionDraft, entryKey, moveEntryInGroup, moveItem, ordered, removeGroup } from './collectionEditing';
import type { EngineeringCollection } from './workspaceTypes';

const collection: EngineeringCollection = {
  id: 'collection', ownerId: 'owner', workspaceId: null, name: 'Personal', version: 4, sortOrder: 0,
  groups: [{ id: 'a', name: 'A', sortOrder: 0 }, { id: 'b', name: 'B', sortOrder: 1 }],
  entries: [
    { toolId: 'EXAMPLE', groupId: 'a', alias: 'First', defaultEndpointId: null, sortOrder: 0 },
    { toolId: 'EXAMPLE', groupId: 'b', alias: 'Second', defaultEndpointId: 'endpoint', sortOrder: 1 },
  ],
};

describe('collection editing', () => {
  it('keeps the server version and independent entry identity without owner fields in a write', () => {
    const draft = collectionDraft(collection);
    expect(draft.expectedVersion).toBe(4);
    expect(draft).not.toHaveProperty('ownerId');
    expect(draft).not.toHaveProperty('workspaceId');
    expect(entryKey(draft.entries[0])).not.toBe(entryKey(draft.entries[1]));
    draft.entries[0].alias = 'Changed';
    expect(collection.entries[0].alias).toBe('First');
    expect(draft.entries[1].alias).toBe('Second');
  });

  it('deletes only the selected group and its entries, preserving the same tool elsewhere', () => {
    const result = removeGroup(collectionDraft(collection), 'a');
    expect(result.groups.map((group) => group.id)).toEqual(['b']);
    expect(result.entries).toEqual([collection.entries[1]]);
  });

  it('reorders entries without mixing aliases or endpoint preferences', () => {
    const result = moveItem(collection.entries, 1, -1);
    expect(result.map((entry) => entry.alias)).toEqual(['Second', 'First']);
    expect(result[0].defaultEndpointId).toBe('endpoint');
    expect(result.map((entry) => entry.sortOrder)).toEqual([0, 1]);
    expect(collection.entries[0].alias).toBe('First');
    expect(moveItem(collection.entries, 0, -1)).toEqual(collection.entries);
  });

  it('moves C ahead of A in g1 while B in g2 stays in place', () => {
    const entries = [
      { toolId: 'A', groupId: 'g1', alias: null, defaultEndpointId: null, sortOrder: 0 },
      { toolId: 'B', groupId: 'g2', alias: null, defaultEndpointId: null, sortOrder: 1 },
      { toolId: 'C', groupId: 'g1', alias: null, defaultEndpointId: null, sortOrder: 2 },
    ];
    const moved = moveEntryInGroup(entries, entryKey(entries[2]), -1);
    expect(ordered(moved).filter((entry) => entry.groupId === 'g1').map((entry) => entry.toolId)).toEqual(['C', 'A']);
    expect(ordered(moved).filter((entry) => entry.groupId === 'g2').map((entry) => entry.toolId)).toEqual(['B']);
    expect(moveEntryInGroup(moved, entryKey(entries[2]), -1)).toEqual(moved);
    expect(entries.map((entry) => entry.toolId)).toEqual(['A', 'B', 'C']);
  });
});
