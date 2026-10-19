import { describe, expect, it } from 'vitest';

import { getNodePostgresPoolConfig } from './web-server';

describe('getNodePostgresPoolConfig', () => {
  it('sets production-safe defaults for node-postgres pools', () => {
    expect(getNodePostgresPoolConfig('postgres://example', {})).toMatchObject({
      application_name: 'comhub-web',
      connectionString: 'postgres://example',
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      max: 20,
      maxLifetimeSeconds: 600,
      statement_timeout: 120_000,
    });
  });

  it('allows deployment-specific pool overrides', () => {
    expect(
      getNodePostgresPoolConfig('postgres://example', {
        DATABASE_APPLICATION_NAME: 'comhub-test',
        DATABASE_CONNECTION_TIMEOUT_MS: 1234,
        DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: 2345,
        DATABASE_IDLE_TIMEOUT_MS: 3456,
        DATABASE_MAX_LIFETIME_SECONDS: 456,
        DATABASE_POOL_MAX: 7,
        DATABASE_STATEMENT_TIMEOUT_MS: 5678,
      }),
    ).toMatchObject({
      application_name: 'comhub-test',
      connectionTimeoutMillis: 1234,
      idleTimeoutMillis: 3456,
      idle_in_transaction_session_timeout: 2345,
      max: 7,
      maxLifetimeSeconds: 456,
      statement_timeout: 5678,
    });
  });
});
