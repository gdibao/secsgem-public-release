import { neonConfig, Pool as NeonPool } from '@neondatabase/serverless';
import { drizzle as neonDrizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { Pool as NodePool, type PoolConfig } from 'pg';
import ws from 'ws';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';

type NodePostgresPoolEnv = Pick<
  typeof serverDBEnv,
  | 'DATABASE_APPLICATION_NAME'
  | 'DATABASE_CONNECTION_TIMEOUT_MS'
  | 'DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS'
  | 'DATABASE_IDLE_TIMEOUT_MS'
  | 'DATABASE_MAX_LIFETIME_SECONDS'
  | 'DATABASE_POOL_MAX'
  | 'DATABASE_STATEMENT_TIMEOUT_MS'
>;

const DEFAULT_NODE_POOL_CONFIG = {
  applicationName: 'comhub-web',
  connectionTimeoutMillis: 10_000,
  idleInTransactionSessionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
  max: 20,
  maxLifetimeSeconds: 600,
  statementTimeoutMillis: 120_000,
};

export const getNodePostgresPoolConfig = (
  connectionString: string,
  env: NodePostgresPoolEnv = serverDBEnv,
): PoolConfig => ({
  application_name: env.DATABASE_APPLICATION_NAME || DEFAULT_NODE_POOL_CONFIG.applicationName,
  connectionString,
  connectionTimeoutMillis:
    env.DATABASE_CONNECTION_TIMEOUT_MS ?? DEFAULT_NODE_POOL_CONFIG.connectionTimeoutMillis,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS ?? DEFAULT_NODE_POOL_CONFIG.idleTimeoutMillis,
  idle_in_transaction_session_timeout:
    env.DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS ??
    DEFAULT_NODE_POOL_CONFIG.idleInTransactionSessionTimeoutMillis,
  max: env.DATABASE_POOL_MAX ?? DEFAULT_NODE_POOL_CONFIG.max,
  maxLifetimeSeconds:
    env.DATABASE_MAX_LIFETIME_SECONDS ?? DEFAULT_NODE_POOL_CONFIG.maxLifetimeSeconds,
  statement_timeout:
    env.DATABASE_STATEMENT_TIMEOUT_MS ?? DEFAULT_NODE_POOL_CONFIG.statementTimeoutMillis,
});

export const getDBInstance = (): LobeChatDatabase => {
  // In test environment, return a mock instance to avoid initialization errors
  if (process.env.NODE_ENV === 'test') return {} as LobeChatDatabase;

  if (!serverDBEnv.KEY_VAULTS_SECRET) {
    throw new Error(
      ` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`,
    );
  }

  const connectionString = serverDBEnv.DATABASE_URL;

  if (!connectionString) {
    throw new Error(`You are try to use database, but "DATABASE_URL" is not set correctly`);
  }

  // Keep NeonPool server-side statement timeouts optional, matching upstream behavior.
  // NodePool uses getNodePostgresPoolConfig so ComHub production keeps stricter defaults.
  const statementTimeout = serverDBEnv.DATABASE_STATEMENT_TIMEOUT;
  const neonTimeoutConfig = statementTimeout
    ? {
        idle_in_transaction_session_timeout: statementTimeout,
        statement_timeout: statementTimeout,
      }
    : {};

  if (serverDBEnv.DATABASE_DRIVER === 'node') {
    const client = new NodePool(getNodePostgresPoolConfig(connectionString));
    // pg.Pool emits 'error' on idle clients when the backend connection drops.
    // Without a listener Node escalates it to uncaughtException and exits the process.
    // See: https://node-postgres.com/apis/pool#error
    client.on('error', (err) => {
      console.error('[NodePool] idle client error (swallowed to prevent process crash):', {
        code: (err as NodeJS.ErrnoException).code,
        message: err.message,
        stack: err.stack,
      });
    });
    return nodeDrizzle(client, { schema });
  }

  if (process.env.MIGRATION_DB === '1') {
    // https://github.com/neondatabase/serverless/blob/main/CONFIG.md#websocketconstructor-typeof-websocket--undefined
    neonConfig.webSocketConstructor = ws;
  }

  const client = new NeonPool({ connectionString, ...neonTimeoutConfig });
  // NeonPool runs over WebSocket; transient drops surface as 'error' on the pool.
  // Without a listener Node escalates it to uncaughtException — on Vercel this killed
  // the entire Lambda 1800+ times in 5 minutes (see LOBE-8704).
  client.on('error', (err: Error) => {
    console.error('[NeonPool] idle client error (swallowed to prevent process crash):', {
      code: (err as NodeJS.ErrnoException).code,
      message: err.message,
      stack: err.stack,
    });
  });
  return neonDrizzle(client, { schema });
};
