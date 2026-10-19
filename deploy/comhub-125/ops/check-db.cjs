const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const req = createRequire('/app/package.json');
const { Pool } = req('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    const extensions = await pool.query("SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('vector', 'pg_search') ORDER BY name");
    console.log(JSON.stringify({ extensions: extensions.rows }));
    if (extensions.rows.length !== 2) throw new Error('Both vector and pg_search must be available');
    if (process.argv[2] === 'preflight') return;
    if (extensions.rows.some(row => !row.installed_version)) throw new Error('Required extension not installed');
    const journal = JSON.parse(readFileSync('/app/migrations/meta/_journal.json', 'utf8'));
    const expected = journal.entries.map(entry => ({
      tag: entry.tag,
      timestamp: String(entry.when),
      hash: createHash('sha256').update(readFileSync(`/app/migrations/${entry.tag}.sql`, 'utf8')).digest('hex'),
    }));
    const { rows } = await pool.query('SELECT hash, created_at::text AS timestamp FROM drizzle.__drizzle_migrations');
    const missing = expected.filter(e => !rows.some(r => r.hash === e.hash && r.timestamp === e.timestamp));
    console.log(JSON.stringify({ expected: expected.length, actual: rows.length, missingTags: missing.map(x => x.tag) }));
    if (missing.length || rows.length !== expected.length) throw new Error('Migration ledger does not match the image journal');
  } finally { await pool.end(); }
})().catch(() => { console.error('Database readiness/ledger verification FAILED; inspect locally without sharing credentials.'); process.exitCode = 1; });
