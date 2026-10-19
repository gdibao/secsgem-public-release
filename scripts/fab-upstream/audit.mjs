import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function inspectJournal(entries) {
  const seen = { idx: new Map(), tag: new Map(), when: new Map() };
  const issues = [];
  let highestTimestamp = -Infinity;
  for (const entry of entries) {
    for (const field of Object.keys(seen)) {
      if (seen[field].has(entry[field])) {
        issues.push({ type: `duplicate-${field}`, tag: entry.tag, previous: seen[field].get(entry[field]) });
      }
      seen[field].set(entry[field], entry.tag);
    }
    if (entry.when <= highestTimestamp) {
      issues.push({ type: 'non-increasing-timestamp', tag: entry.tag, when: entry.when, highestTimestamp });
    }
    highestTimestamp = Math.max(highestTimestamp, entry.when);
  }
  return issues;
}

export function compareTrees(base, source, target) {
  const rows = [];
  const paths = [...new Set([...base.keys(), ...source.keys(), ...target.keys()])].sort();
  for (const file of paths) {
    const b = base.get(file) ?? null;
    const s = source.get(file) ?? null;
    const t = target.get(file) ?? null;
    if (b === s) continue;
    const status = s === t ? 'already-present' : b === t ? 'source-only-change' : 'overlapping-change';
    rows.push({ path: file, status, base: b, source: s, target: t });
  }
  return rows;
}

function audit(repo, output) {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const tree = (ref) => new Map(git('ls-tree', '-rz', ref).split('\0').filter(Boolean).map((line) => {
    const split = line.indexOf('\t');
    return [line.slice(split + 1), line.slice(0, split)];
  }));
  const sources = {
    lobeLegacy: 'ca27228d55bb604f8bcf455a18f5e87d3ba9f9a5',
    lobeTarget: '14dfc07b14eee1984e52c195df9319636d6b167b',
    comhubLegacy: 'd5d7eeb9f07b689df27bd8306fb1df62efa8229e',
    comhubTarget: '09d4aec1533f541f8e8568f0e4fd6ee069ea2cb2',
    fabInitial: 'efc21d64d3b0d81557ca1347e16f667e398a18c4',
    fabCurrent: '39ba9e234e804bc229966262c85cac59fb326e5a',
  };
  const trees = Object.fromEntries(Object.entries(sources).map(([name, ref]) => [name, tree(ref)]));
  const journalPath = 'packages/database/migrations/meta/_journal.json';
  const baselines = {};
  const migrations = {};
  for (const [name, ref] of Object.entries(sources)) {
    const pkg = JSON.parse(git('show', `${ref}:package.json`));
    const entries = JSON.parse(git('show', `${ref}:${journalPath}`)).entries;
    const records = entries.map((entry) => {
      const file = `packages/database/migrations/${entry.tag}.sql`;
      const exists = trees[name].has(file);
      return { ...entry, exists, sha256: exists ? createHash('sha256').update(git('show', `${ref}:${file}`)).digest('hex') : null };
    });
    baselines[name] = {
      commit: ref, tree: git('rev-parse', `${ref}^{tree}`).trim(),
      packageVersion: pkg.version, packageManager: pkg.packageManager,
      hasRootLockfile: trees[name].has('pnpm-lock.yaml'),
      journalEntries: entries.length, journalLastEntry: entries.at(-1)?.tag,
      journalMaxTimestamp: Math.max(...entries.map((e) => e.when)),
    };
    migrations[name] = { records, issues: inspectJournal(entries) };
  }
  const compareMigrations = (leftName, rightName) => {
    const left = new Map(migrations[leftName].records.map((row) => [row.tag, row]));
    return migrations[rightName].records.map((row) => {
      const prior = left.get(row.tag);
      return {
        tag: row.tag,
        status: !prior ? 'absent-from-source-journal' : row.sha256 !== prior.sha256 ? 'sql-changed' : row.when !== prior.when ? 'timestamp-changed' : 'same',
        sourceWhen: prior?.when ?? null, targetWhen: row.when,
        sourceHash: prior?.sha256 ?? null, targetHash: row.sha256,
      };
    });
  };
  const layers = {
    comhubLegacyAgainstLobeTarget: compareTrees(trees.lobeLegacy, trees.comhubLegacy, trees.lobeTarget),
    comhubEvolutionAgainstLobeTarget: compareTrees(trees.comhubLegacy, trees.comhubTarget, trees.lobeTarget),
    fabInitialAgainstComhubTarget: compareTrees(trees.comhubLegacy, trees.fabInitial, trees.comhubTarget),
    fabEvolutionAgainstComhubTarget: compareTrees(trees.fabInitial, trees.fabCurrent, trees.comhubTarget),
  };
  const summary = Object.fromEntries(Object.entries(layers).map(([name, rows]) => [name,
    rows.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {}),
  ]));
  const result = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), baselines, summary,
    scope: 'committed-source-only; no production database access; no automatic application of patches',
    limitation: 'Tree equality is not semantic compatibility. source-only-change still requires review. Current uncommitted Fab changes must be captured separately.',
    layers, migrations,
    migrationComparisons: {
      fabToComhub: compareMigrations('fabCurrent', 'comhubTarget'),
      fabToLobe: compareMigrations('fabCurrent', 'lobeTarget'),
    },
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'baseline-audit.json'), JSON.stringify(result, null, 2) + '\n');
  for (const [name, rows] of Object.entries(layers)) {
    writeFileSync(path.join(output, `${name}.tsv`), 'status\tpath\n' + rows.map((r) => `${r.status}\t${r.path}`).join('\n') + '\n');
  }
  console.log(JSON.stringify({ baselines, summary, journalIssues: Object.fromEntries(Object.entries(migrations).map(([k, v]) => [k, v.issues.length])), output }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, output] = process.argv.slice(2);
  if (!repo || !output) throw new Error('Usage: node audit.mjs LOCAL_BARE_REPO OUTPUT_DIRECTORY');
  audit(path.resolve(repo), path.resolve(output));
}
