import {
  ADMIN_COMMANDS,
  type AdminCommandEnvelope,
  type AdminCommandId,
  type AdminCommandReasonPolicy,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

const adminCommandEnvelopeSchema = z
  .object({
    actionId: z.string().min(1),
    confirmationText: z.string().max(200).optional(),
    confirmed: z.boolean().optional(),
    reason: z.string().max(500).nullish(),
  })
  .strict();

const commandError = (code: 'BAD_REQUEST' | 'FORBIDDEN', message: string): never => {
  throw new TRPCError({ code, message });
};

const normalizeReason = (reason?: null | string) => reason?.trim() || undefined;

export const resolveAdminCommandReason = ({
  envelopeReason,
  legacyReason,
  reasonPolicy,
}: {
  envelopeReason?: null | string;
  legacyReason?: null | string;
  reasonPolicy: AdminCommandReasonPolicy;
}) => {
  if (reasonPolicy === 'none') return undefined;

  const normalizedEnvelopeReason = normalizeReason(envelopeReason);
  const normalizedLegacyReason = normalizeReason(legacyReason);
  if (
    normalizedEnvelopeReason &&
    normalizedLegacyReason &&
    normalizedEnvelopeReason !== normalizedLegacyReason
  ) {
    commandError('BAD_REQUEST', 'ADMIN_COMMAND_REASON_MISMATCH');
  }

  const reason = normalizedEnvelopeReason ?? normalizedLegacyReason;
  if (reasonPolicy === 'required' && !reason) {
    commandError('BAD_REQUEST', 'ADMIN_COMMAND_REASON_REQUIRED');
  }

  return reason;
};

export const createAdminCommand = <TActionId extends AdminCommandId>(actionId: TActionId) => {
  const definition = ADMIN_COMMANDS[actionId];
  const validate = (value: unknown, legacyReason?: null | string) => {
    if (value == null) commandError('BAD_REQUEST', 'ADMIN_COMMAND_REQUIRED');

    const parsed = adminCommandEnvelopeSchema.safeParse(value);
    const envelope: AdminCommandEnvelope = parsed.success
      ? parsed.data
      : commandError('BAD_REQUEST', 'ADMIN_COMMAND_INVALID');
    if (envelope.actionId !== actionId) {
      commandError('FORBIDDEN', 'ADMIN_COMMAND_ACTION_MISMATCH');
    }

    if (definition.confirmationMode !== 'none' && envelope.confirmed !== true) {
      commandError('BAD_REQUEST', 'ADMIN_COMMAND_CONFIRMATION_REQUIRED');
    }

    if (
      definition.confirmationMode === 'typed' &&
      envelope.confirmationText?.trim() !== definition.actionId
    ) {
      commandError('BAD_REQUEST', 'ADMIN_COMMAND_CONFIRMATION_TEXT_MISMATCH');
    }

    const reason = resolveAdminCommandReason({
      envelopeReason: envelope.reason,
      legacyReason,
      reasonPolicy: definition.reasonPolicy,
    });

    return {
      actionId: definition.actionId,
      auditAction: definition.auditAction,
      reason,
    };
  };

  return {
    definition,
    schema: adminCommandEnvelopeSchema.nullish().describe(
      definition.serverBoundary.kind === 'trpc'
        ? definition.serverBoundary.procedurePath
        : `${definition.serverBoundary.method} ${definition.serverBoundary.path}`,
    ),
    validate,
  };
};
