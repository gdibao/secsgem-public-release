import { describe, expect, it } from 'vitest';

import { getWorkspacePilotError } from './workspacePilotError';

describe('getWorkspacePilotError', () => {
  it('distinguishes permissions, missing identities, conflicts, and expired login', () => {
    expect(getWorkspacePilotError({ data: { code: 'FORBIDDEN' } })).toContain('权限');
    expect(getWorkspacePilotError({ data: { code: 'NOT_FOUND' } })).toContain('未绑定');
    expect(getWorkspacePilotError({ data: { code: 'CONFLICT' } })).toContain('已是成员');
    expect(getWorkspacePilotError({ data: { code: 'UNAUTHORIZED' } })).toContain('重新登录');
  });

  it('does not leak upstream error details', () => {
    expect(getWorkspacePilotError(new Error('private-account-id'))).not.toContain(
      'private-account-id',
    );
  });
});
