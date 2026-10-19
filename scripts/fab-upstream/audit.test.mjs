import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTrees, inspectJournal } from './audit.mjs';

test('detects appended earlier timestamps even when adjacent entries increase', () => {
  const rows = [{ idx: 0, tag: 'a', when: 100 }, { idx: 1, tag: 'b', when: 200 },
    { idx: 1, tag: 'c', when: 150 }, { idx: 2, tag: 'd', when: 160 }];
  const issues = inspectJournal(rows);
  assert.deepEqual(issues.filter((x) => x.type === 'non-increasing-timestamp').map((x) => x.tag), ['c', 'd']);
  assert.equal(issues.filter((x) => x.type === 'duplicate-idx').length, 1);
});

test('valid journal produces no warnings', () => {
  assert.deepEqual(inspectJournal([{ idx: 0, tag: 'a', when: 100 }, { idx: 1, tag: 'b', when: 200 }]), []);
});

test('separates existing work, disjoint additions, collisions and source deletions', () => {
  const base = new Map([['unchanged', 'a'], ['shared', 'a'], ['delete', 'a']]);
  const source = new Map([['unchanged', 'a'], ['shared', 'b'], ['new', 'n'], ['already', 'x']]);
  const target = new Map([['unchanged', 'b'], ['shared', 'c'], ['delete', 'a'], ['already', 'x']]);
  assert.deepEqual(compareTrees(base, source, target).map(({ path, status }) => [path, status]), [
    ['already', 'already-present'], ['delete', 'source-only-change'], ['new', 'source-only-change'], ['shared', 'overlapping-change'],
  ]);
});
