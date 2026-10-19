const { createRequire } = require('node:module');
const { Pool } = createRequire('/app/package.json')('pg');

// Equivalent role assignment to upstream scripts/promoteAdmin.ts, no account creation.
// Operator must verify the existing real owner's identity before supplying the ID.
(async () => {
  const id = process.env.ADMIN_USER_ID;
  if (!id || !/^user_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Explicit real owner user ID required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await connection.query('SELECT id, role, banned FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (rows.length !== 1 || rows[0].banned) throw new Error('Owner missing or banned');
    const existing = await connection.query("SELECT id FROM users WHERE role='admin' AND id<>$1", [id]);
    if (existing.rowCount) throw new Error('Another admin already exists; stop for review');
    await connection.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
    await connection.query('COMMIT');
    console.log('Existing verified owner granted admin; record this operation in deployment evidence.');
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  finally { connection.release(); await pool.end(); }
})().catch(() => { console.error('Owner promotion FAILED; no new account was created.'); process.exitCode = 1; });
