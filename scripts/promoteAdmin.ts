/* eslint-disable no-console */
/**
 * Promote a user to admin role (sets users.role = 'admin').
 * Usage:
 *   bun run admin:promote --email user@example.com
 *   bun run admin:promote --user <userId>
 *   bun run admin:promote --email user@example.com --revoke
 */
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { eq } from 'drizzle-orm';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    email: get('--email'),
    help: args.includes('--help') || args.includes('-h'),
    revoke: args.includes('--revoke'),
    user: get('--user'),
  };
};

const printHelp = () => {
  console.log(`
Promote a user to admin role.

Usage:
  bun run admin:promote --email user@example.com
  bun run admin:promote --user <userId>
  bun run admin:promote --email user@example.com --revoke

Options:
  --email <email>   Lookup user by email (normalized)
  --user <userId>   Direct user id
  --revoke          Clear role (set NULL) instead of granting admin
  --help, -h        Show this help
`);
};

const main = async () => {
  const opts = parseArgs();
  if (opts.help || (!opts.email && !opts.user)) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  const { getServerDB } = await import('../packages/database/src/core/db-adaptor');
  const { users } = await import('../packages/database/src/schemas/user');

  const db = await getServerDB();
  const where = opts.user
    ? eq(users.id, opts.user)
    : eq(users.normalizedEmail, (opts.email as string).trim().toLowerCase());

  const found = await db.query.users.findFirst({
    columns: { email: true, fullName: true, id: true, role: true },
    where,
  });

  if (!found) {
    console.error('User not found.');
    process.exit(2);
  }

  const newRole = opts.revoke ? null : 'admin';
  await db.update(users).set({ role: newRole }).where(eq(users.id, found.id));

  console.log(
    `${opts.revoke ? 'Revoked' : 'Granted admin to'} user ${found.id} (${found.email}) — was role=${found.role ?? 'null'}, now role=${newRole ?? 'null'}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
