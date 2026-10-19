import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getServerDBConfig = () => {
  return createEnv({
    runtimeEnv: {
      DATABASE_APPLICATION_NAME: process.env.DATABASE_APPLICATION_NAME,
      DATABASE_CONNECTION_TIMEOUT_MS: process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      DATABASE_DRIVER: process.env.DATABASE_DRIVER || 'neon',
      DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS:
        process.env.DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
      DATABASE_IDLE_TIMEOUT_MS: process.env.DATABASE_IDLE_TIMEOUT_MS,
      DATABASE_MAX_LIFETIME_SECONDS: process.env.DATABASE_MAX_LIFETIME_SECONDS,
      DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
      DATABASE_STATEMENT_TIMEOUT: process.env.DATABASE_STATEMENT_TIMEOUT,
      DATABASE_STATEMENT_TIMEOUT_MS: process.env.DATABASE_STATEMENT_TIMEOUT_MS,
      DATABASE_TEST_URL: process.env.DATABASE_TEST_URL,
      DATABASE_URL: process.env.DATABASE_URL,

      KEY_VAULTS_SECRET: process.env.KEY_VAULTS_SECRET,

      REMOVE_GLOBAL_FILE: process.env.DISABLE_REMOVE_GLOBAL_FILE !== '0',
    },
    server: {
      DATABASE_APPLICATION_NAME: z.string().optional(),
      DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
      DATABASE_DRIVER: z.enum(['neon', 'node']),
      DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .optional(),
      DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
      DATABASE_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().optional(),
      DATABASE_POOL_MAX: z.coerce.number().int().positive().optional(),
      // Server-side timeout (in milliseconds) for Neon/serverless connections.
      // Node PostgreSQL pools use DATABASE_STATEMENT_TIMEOUT_MS so deployments can
      // keep existing ComHub pool settings unchanged.
      DATABASE_STATEMENT_TIMEOUT: z.coerce.number().int().positive().optional(),
      DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
      DATABASE_TEST_URL: z.string().optional(),
      DATABASE_URL: z.string().optional(),

      KEY_VAULTS_SECRET: z.string().optional(),

      REMOVE_GLOBAL_FILE: z.boolean().optional(),
    },
  });
};

export const serverDBEnv = getServerDBConfig();
