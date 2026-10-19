import type { CollectionEntry, CollectionWrite, EngineeringCollection } from './workspaceTypes';

export const entryKey = (entry: Pick<CollectionEntry, 'groupId' | 'toolId'>) => JSON.stringify([entry.groupId, entry.toolId]);

export const collectionDraft = (collection?: EngineeringCollection): CollectionWrite => collection ? {
  id: collection.id,
  expectedVersion: collection.version,
  name: collection.name,
  sortOrder: collection.sortOrder,
  groups: structuredClone(collection.groups),
  entries: structuredClone(collection.entries),
} : { name: '', sortOrder: 0, groups: [], entries: [] };

export const ordered = <T extends { sortOrder: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder);

export const moveItem = <T extends { sortOrder: number }>(items: T[], index: number, direction: -1 | 1): T[] => {
  const result = ordered(items);
  const next = index + direction;
  if (index < 0 || index >= result.length || next < 0 || next >= result.length) return result;
  [result[index], result[next]] = [result[next], result[index]];
  return result.map((item, sortOrder) => ({ ...item, sortOrder }));
};

export const moveEntryInGroup = (items: CollectionEntry[], key: string, direction: -1 | 1): CollectionEntry[] => {
  const result = ordered(items);
  const entry = result.find((item) => entryKey(item) === key);
  if (!entry) return result;
  const visible = result.filter((item) => item.groupId === entry.groupId);
  const index = visible.findIndex((item) => entryKey(item) === key);
  const other = visible[index + direction];
  if (!other) return result;
  const currentIndex = result.findIndex((item) => entryKey(item) === key);
  const otherIndex = result.findIndex((item) => entryKey(item) === entryKey(other));
  [result[currentIndex], result[otherIndex]] = [result[otherIndex], result[currentIndex]];
  return result.map((item, sortOrder) => ({ ...item, sortOrder }));
};

export const removeGroup = (draft: CollectionWrite, groupId: string): CollectionWrite => ({
  ...draft,
  groups: draft.groups.filter((group) => group.id !== groupId),
  entries: draft.entries.filter((entry) => entry.groupId !== groupId),
});
