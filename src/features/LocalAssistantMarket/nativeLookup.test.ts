import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Execute the real model method with a minimal SQL predicate interpreter.
// The visibility fixture deliberately includes a newer shared entry.
const file = ts.createSourceFile(
  'agent.ts',
  readFileSync('packages/database/src/models/agent.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const model = file.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'AgentModel',
) as ts.ClassDeclaration;
const method = model.members.find(
  (node) => node.name?.getText(file) === 'getAgentByMarketIdentifier',
) as ts.PropertyDeclaration;
const js = ts.transpileModule(`const lookup = ${method.initializer!.getText(file)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const and =
  (...predicates: any[]) =>
  (row: any) =>
    predicates.filter(Boolean).every((predicate) => predicate(row));
const eq = (column: string, value: unknown) => (row: any) => row[column] === value;
const agents = { marketIdentifier: 'marketIdentifier', userId: 'userId', visibility: 'visibility' };

describe('native owned-private query regression', () => {
  it('finds older private copy before sorting shared entries, retaining scope', async () => {
    const rows = [
      {
        id: 'other-scope',
        marketIdentifier: 'local',
        userId: 'alice',
        visibility: 'private',
        workspace: 'b',
        updatedAt: 3,
      },
      {
        id: 'bob-shared-newer',
        marketIdentifier: 'local',
        userId: 'bob',
        visibility: 'public',
        workspace: 'a',
        updatedAt: 2,
      },
      {
        id: 'own-edited',
        marketIdentifier: 'local',
        userId: 'alice',
        visibility: 'private',
        workspace: 'a',
        updatedAt: 1,
        systemRole: 'edited',
      },
    ];
    const context = {
      userId: 'alice',
      ownership: () => (row: any) =>
        row.workspace === 'a' && (row.visibility === 'public' || row.userId === 'alice'),
      db: {
        query: {
          agents: {
            findFirst: async ({ where }: any) =>
              rows.filter(where).sort((a, b) => b.updatedAt - a.updatedAt)[0],
          },
        },
      },
    };
    const lookup = new Function('and', 'eq', 'agents', `${js}\nreturn lookup;`).call(
      context,
      and,
      eq,
      agents,
    );
    expect(await lookup('local')).toBe('bob-shared-newer');
    expect(await lookup('local', true)).toBe('own-edited');
    expect(rows).toHaveLength(3);
    expect(rows[2].systemRole).toBe('edited');
  });
});
