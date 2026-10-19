import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createAdminCommand } from './adminCommand';

const expectCommandError = (run: () => unknown, code: TRPCError['code'], message: string) => {
  try {
    run();
    throw new Error('Expected command validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code, message });
  }
};

describe('createAdminCommand', () => {
  it('rejects a missing confirmation envelope for a high severity confirm action', () => {
    const command = createAdminCommand('content.deleteDocument');

    expectCommandError(() => command.validate(undefined), 'BAD_REQUEST', 'ADMIN_COMMAND_REQUIRED');
    expectCommandError(() => command.validate(null), 'BAD_REQUEST', 'ADMIN_COMMAND_REQUIRED');
    expect(command.schema.safeParse(null).success).toBe(true);
    expectCommandError(
      () => command.validate({ actionId: 'content.deleteDocument' }),
      'BAD_REQUEST',
      'ADMIN_COMMAND_CONFIRMATION_REQUIRED',
    );
  });

  it('rejects a command replayed against another procedure as forbidden', () => {
    const command = createAdminCommand('content.deleteDocument');

    expectCommandError(
      () =>
        command.validate({
          actionId: 'content.deleteFile',
          confirmed: true,
        }),
      'FORBIDDEN',
      'ADMIN_COMMAND_ACTION_MISMATCH',
    );
  });

  it('requires confirmation for a medium severity confirm action', () => {
    const command = createAdminCommand('order.cancel');

    expect(command.definition.severity).toBe('medium');
    expectCommandError(
      () => command.validate({ actionId: 'order.cancel' }),
      'BAD_REQUEST',
      'ADMIN_COMMAND_CONFIRMATION_REQUIRED',
    );
  });

  it('rejects wrong typed text and blank required reasons for a critical action', () => {
    const command = createAdminCommand('credits.adjust');

    expectCommandError(
      () =>
        command.validate({
          actionId: 'credits.adjust',
          confirmationText: 'wrong',
          confirmed: true,
          reason: 'manual correction',
        }),
      'BAD_REQUEST',
      'ADMIN_COMMAND_CONFIRMATION_TEXT_MISMATCH',
    );
    expectCommandError(
      () =>
        command.validate({
          actionId: 'credits.adjust',
          confirmationText: 'credits.adjust',
          confirmed: true,
          reason: '   ',
        }),
      'BAD_REQUEST',
      'ADMIN_COMMAND_REASON_REQUIRED',
    );
  });

  it('accepts one normalized legacy or envelope reason and rejects conflicting values', () => {
    const command = createAdminCommand('order.settle');
    const envelope = {
      actionId: 'order.settle',
      confirmationText: 'order.settle',
      confirmed: true,
    } as const;

    expect(command.validate(envelope, '  manual transfer confirmed  ')).toMatchObject({
      reason: 'manual transfer confirmed',
    });
    expect(
      command.validate({ ...envelope, reason: ' manual transfer confirmed ' }, 'manual transfer confirmed'),
    ).toMatchObject({ reason: 'manual transfer confirmed' });
    expectCommandError(
      () => command.validate({ ...envelope, reason: 'finance evidence A' }, 'finance evidence B'),
      'BAD_REQUEST',
      'ADMIN_COMMAND_REASON_MISMATCH',
    );
  });

  it('exposes canonical audit metadata and a sanitized optional reason', () => {
    const command = createAdminCommand('subscription.changeRequest.bulkReject');

    expect(
      command.validate({
        actionId: 'subscription.changeRequest.bulkReject',
        confirmed: true,
        reason: '  invalid account evidence  ',
      }),
    ).toEqual({
      actionId: 'subscription.changeRequest.bulkReject',
      auditAction: 'subscription.changeRequest.bulkReject',
      reason: 'invalid account evidence',
    });
  });

  it('exposes catalog audit metadata for medium severity actions with no confirmation mode', () => {
    const command = createAdminCommand('setting.setAppSetting');

    expect(command.definition).toMatchObject({
      auditAction: 'settings.set',
      confirmationMode: 'none',
      severity: 'medium',
    });
  });
});
