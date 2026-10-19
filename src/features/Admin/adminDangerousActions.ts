import {
  ADMIN_COMMANDS,
  type AdminCommandDefinition,
  type AdminCommandEnvelope,
  type AdminCommandId,
  getAdminCommandDefinition,
} from '@lobechat/types';

export { ADMIN_COMMANDS as ADMIN_DANGEROUS_ACTIONS };
export type AdminDangerousActionId = AdminCommandId;
export type AdminDangerousActionSeverity = AdminCommandDefinition['severity'];
export type AdminDangerousActionConfirmationInput = Omit<AdminCommandEnvelope, 'actionId'>;
export type AdminDangerousActionEnvelope<TActionId extends AdminCommandId = AdminCommandId> =
  AdminCommandEnvelope<TActionId>;

export type AdminDangerousActionConfirm = AdminCommandDefinition & {
  allowsReason: boolean;
  confirmation: {
    description: string;
    title: string;
  };
  requiredConfirmationText?: string;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  requiresTypedConfirmation: boolean;
};

export type AdminDangerousActionConfirmationError =
  'confirmation_required' | 'confirmation_text_mismatch' | 'reason_required' | 'unknown_action';

export type AdminDangerousActionConfirmationResult = {
  errors: AdminDangerousActionConfirmationError[];
  ok: boolean;
  requirement?: AdminDangerousActionConfirm;
};

const adaptAdminCommandDefinition = (
  definition: AdminCommandDefinition,
): AdminDangerousActionConfirm => {
  const requiresTypedConfirmation = definition.confirmationMode === 'typed';

  return {
    ...definition,
    allowsReason: definition.reasonPolicy !== 'none',
    confirmation: {
      description: definition.description,
      title: definition.title,
    },
    requiredConfirmationText: requiresTypedConfirmation ? definition.actionId : undefined,
    requiresConfirmation: definition.confirmationMode !== 'none',
    requiresReason: definition.reasonPolicy === 'required',
    requiresTypedConfirmation,
  };
};

export const getAdminDangerousAction = (actionId: string) => {
  const definition = getAdminCommandDefinition(actionId);
  return definition ? adaptAdminCommandDefinition(definition) : undefined;
};

export const requiresAdminActionReason = (actionId: string) =>
  getAdminCommandDefinition(actionId)?.reasonPolicy === 'required';

export const buildAdminDangerousActionConfirm = getAdminDangerousAction;

export const buildAdminDangerousActionEnvelope = <TActionId extends AdminDangerousActionId>(
  actionId: TActionId,
  input: AdminDangerousActionConfirmationInput,
): AdminDangerousActionEnvelope<TActionId> => ({
  ...input,
  actionId,
  reason: input.reason?.trim() || undefined,
});

export const validateAdminDangerousActionConfirmation = (
  actionId: string,
  input: AdminDangerousActionConfirmationInput = {},
): AdminDangerousActionConfirmationResult => {
  const requirement = buildAdminDangerousActionConfirm(actionId);
  if (!requirement) return { errors: ['unknown_action'], ok: false };

  const errors: AdminDangerousActionConfirmationError[] = [];

  if (requirement.requiresConfirmation && !input.confirmed) {
    errors.push('confirmation_required');
  }

  if (
    requirement.requiresTypedConfirmation &&
    input.confirmationText?.trim() !== requirement.requiredConfirmationText
  ) {
    errors.push('confirmation_text_mismatch');
  }

  if (requirement.requiresReason && !input.reason?.trim()) {
    errors.push('reason_required');
  }

  return {
    errors,
    ok: errors.length === 0,
    requirement,
  };
};
