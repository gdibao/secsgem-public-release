// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile publication procedures', () => {
  it('exposes draft, publish, rollback, history, and public snapshot contracts', () => {
    const reads = readSource('./readers/mobilePublicationProcedures.ts');
    const writes = readSource('./writers/mobilePublicationProcedures.ts');
    const router = readSource('../lambda-routers/admin/settings.ts');

    expect(reads).toContain('getMobileConfigPublication: systemReadProcedure');
    expect(reads).toContain('getPublicMobileConfigSnapshot: publicDbProcedure');
    expect(writes).toContain('saveMobileConfigDraft: systemWriteProcedure');
    expect(writes).toContain('publishMobileConfig: systemWriteProcedure');
    expect(writes).toContain('rollbackMobileConfig: systemWriteProcedure');
    expect(writes).toContain('expectedDraftRevision');
    expect(writes).toContain("code: 'CONFLICT'");
    expect(writes).toContain('pg_advisory_xact_lock');
    expect(router).toContain('...mobilePublicationReadProcedures');
    expect(router).toContain('...mobilePublicationWriteProcedures');
  });
});
